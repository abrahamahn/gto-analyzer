import type { Card, Street } from "@poker/shared";
import { freshDeck, mulberry32, shuffle } from "./deck.js";
import { awardPots, buildPots } from "./showdown.js";
import type { GameAction, GameConfig, GameState, LegalAction, PlayerState, Pot } from "./types.js";

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river"];

export function createGame(config: GameConfig, seed = Date.now() >>> 0): GameState {
  const players: PlayerState[] = config.seats.map((s, seat) => ({
    seat,
    name: s.name,
    isHuman: s.isHuman,
    difficulty: s.difficulty ?? 0.7,
    stack: config.startingStack,
    holeCards: null,
    status: "active",
    committedThisStreet: 0,
    committedThisHand: 0,
    hasActedThisStreet: false,
  }));
  return {
    config,
    handNumber: 0,
    buttonSeat: 0,
    phase: "complete",
    board: [],
    deck: [],
    players,
    currentBet: 0,
    minRaise: config.bigBlind,
    actedSinceFullRaise: [],
    toAct: null,
    lastAggressor: null,
    street: "preflop",
    actions: [],
    history: [],
    result: null,
    rngState: seed >>> 0,
  };
}

const inPlay = (p: PlayerState) => p.status !== "out";
const canAct = (p: PlayerState) => p.status === "active";
const liveInHand = (p: PlayerState) => p.status === "active" || p.status === "all-in";

function nextSeat(state: GameState, from: number, pred: (p: PlayerState) => boolean): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (pred(state.players[seat]!)) return seat;
  }
  return from;
}

/** Begin a new hand: rotate button, top up (cash), post blinds/antes, deal. */
export function startHand(state: GameState): GameState {
  const { config } = state;
  state.handNumber += 1;
  if (state.handNumber > 1) state.buttonSeat = nextSeat(state, state.buttonSeat, inPlay);

  for (const p of state.players) {
    p.stack = config.startingStack; // cash top-up
    p.holeCards = null;
    p.status = "active";
    p.committedThisStreet = 0;
    p.committedThisHand = 0;
    p.hasActedThisStreet = false;
  }

  const rng = mulberry32(state.rngState);
  const deck = shuffle(freshDeck(), rng.next);
  state.rngState = rng.state();

  // Antes (dead money — do not count toward the current bet).
  if (config.ante > 0) {
    for (const p of state.players) {
      if (!inPlay(p)) continue;
      const a = Math.min(config.ante, p.stack);
      p.stack -= a;
      p.committedThisHand += a;
      if (p.stack === 0) p.status = "all-in";
    }
  }

  const n = state.players.length;
  const hebutton = state.buttonSeat;
  const sbSeat = n === 2 ? hebutton : nextSeat(state, hebutton, inPlay);
  const bbSeat = nextSeat(state, sbSeat, inPlay);
  postBlind(state, sbSeat, config.smallBlind);
  postBlind(state, bbSeat, config.bigBlind);

  for (const p of state.players) {
    if (inPlay(p)) p.holeCards = [deck.pop()!, deck.pop()!];
  }
  state.deck = deck;

  state.board = [];
  state.phase = "preflop";
  state.street = "preflop";
  state.currentBet = config.bigBlind;
  state.minRaise = config.bigBlind;
  state.actedSinceFullRaise = [];
  state.lastAggressor = bbSeat;
  state.actions = [];
  state.history = [];
  state.result = null;
  state.toAct = nextSeat(state, bbSeat, canAct); // UTG (HU: the button/SB)
  return state;
}

function postBlind(state: GameState, seat: number, amount: number): void {
  const p = state.players[seat]!;
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.committedThisStreet = a;
  p.committedThisHand += a;
  if (p.stack === 0) p.status = "all-in";
}

export function legalActions(state: GameState, seat: number): LegalAction[] {
  const p = state.players[seat]!;
  if (state.toAct !== seat || !canAct(p)) return [];
  const toCall = state.currentBet - p.committedThisStreet;
  const out: LegalAction[] = [];

  if (toCall <= 0) out.push({ type: "check" });
  else out.push({ type: "fold" }, { type: "call" });

  const maxTo = p.committedThisStreet + p.stack; // all-in total this street
  const canReopen = !state.actedSinceFullRaise.includes(seat);
  if (canReopen && maxTo > state.currentBet) {
    const minRaiseTo = state.currentBet + state.minRaise;
    const type = state.currentBet === 0 ? "bet" : "raise";
    out.push({ type, min: Math.min(minRaiseTo, maxTo), max: maxTo });
  }
  return out;
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.phase === "complete" || state.toAct === null) {
    throw new Error("hand is complete; start a new hand");
  }
  const seat = action.seat;
  if (state.toAct !== seat) throw new Error(`not seat ${seat}'s turn`);
  const p = state.players[seat]!;
  const legal = legalActions(state, seat);
  const match = legal.find((l) => l.type === action.type);
  if (!match) throw new Error(`illegal action ${action.type} for seat ${seat}`);

  const prevBet = state.currentBet;
  switch (action.type) {
    case "fold":
      p.status = "folded";
      break;
    case "check":
      break;
    case "call":
      commit(p, state.currentBet - p.committedThisStreet);
      break;
    case "bet":
    case "raise": {
      const target = action.amount ?? match.min ?? 0;
      if (target < (match.min ?? 0) || target > (match.max ?? 0)) {
        throw new Error(`${action.type} to ${target} outside legal [${match.min}, ${match.max}]`);
      }
      commit(p, target - p.committedThisStreet);
      const fullRaise = target - prevBet >= state.minRaise;
      state.currentBet = target;
      state.lastAggressor = seat;
      if (fullRaise) {
        state.minRaise = target - prevBet;
        state.actedSinceFullRaise = [seat];
      } else {
        state.actedSinceFullRaise.push(seat); // under-raise all-in: does not reopen
      }
      break;
    }
  }

  p.hasActedThisStreet = true;
  if (!state.actedSinceFullRaise.includes(seat)) state.actedSinceFullRaise.push(seat);
  recordAction(state, action);

  if (state.players.filter(liveInHand).length <= 1) {
    finishHand(state);
    return state;
  }

  const next = nextToAct(state, seat);
  if (next === null) endBettingRound(state);
  else state.toAct = next;
  return state;
}

function commit(p: PlayerState, amount: number): number {
  const a = Math.min(Math.max(0, amount), p.stack);
  p.stack -= a;
  p.committedThisStreet += a;
  p.committedThisHand += a;
  if (p.stack === 0) p.status = "all-in";
  return a;
}

function recordAction(state: GameState, action: GameAction): void {
  state.actions.push(action);
}

/** Next seat that still owes action this street, or null if the round is closed. */
function nextToAct(state: GameState, from: number): number | null {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    const p = state.players[seat]!;
    if (!canAct(p)) continue;
    if (!p.hasActedThisStreet || p.committedThisStreet < state.currentBet) return seat;
  }
  return null;
}

function endBettingRound(state: GameState): void {
  recordStreetHistory(state);
  proceedToNextStreet(state);
}

/** Append the current street's actions to history exactly once. */
function recordStreetHistory(state: GameState): void {
  const last = state.history[state.history.length - 1];
  if (last && last.street === state.street) return;
  state.history.push({ street: state.street, board: [...state.board], actions: [...state.actions] });
}

function proceedToNextStreet(state: GameState): void {
  // Auto-run remaining streets when ≤1 player can still act but ≥2 are live.
  while (true) {
    const idx = STREET_ORDER.indexOf(state.street);
    if (state.street === "river") {
      finishHand(state);
      return;
    }
    const nextStreet = STREET_ORDER[idx + 1]!;
    dealStreet(state, nextStreet);
    state.street = nextStreet;
    state.phase = nextStreet;
    for (const p of state.players) {
      p.committedThisStreet = 0;
      p.hasActedThisStreet = false;
    }
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    state.actedSinceFullRaise = [];
    state.lastAggressor = null;
    state.actions = [];

    if (state.players.filter(canAct).length >= 2) {
      state.toAct = nextSeat(state, state.buttonSeat, canAct); // first active left of button
      return;
    }
    // Otherwise no betting this street; loop to deal the next one.
  }
}

function dealStreet(state: GameState, street: Street): void {
  const count = street === "flop" ? 3 : 1;
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) cards.push(state.deck.pop()!);
  state.board.push(...cards);
}

function finishHand(state: GameState): void {
  recordStreetHistory(state); // capture the final street's actions
  const live = state.players.filter(liveInHand);
  const pots = buildPots(state.players);
  // Rake the pot ("no flop, no drop"): scale every pot down before awarding.
  const rake = takeRake(state, pots);

  if (live.length === 1) {
    // Uncontested: the lone live player takes everything, no cards shown.
    const winner = live[0]!;
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    winner.stack += total;
    state.result = {
      pots: [{ amount: total, winners: [winner.seat] }],
      net: netBySeat(state),
      shown: [],
      rake,
    };
  } else {
    // Auto-deal any missing board cards (everyone all-in earlier), then show down.
    while (state.board.length < 5) dealStreet(state, state.board.length < 3 ? "flop" : "turn");
    const { results, shown } = awardPots(pots, state.players, state.board, state.buttonSeat);
    state.result = { pots: results, net: netBySeat(state), shown, rake };
  }
  state.phase = "complete";
  state.street = "river";
  state.toAct = null;
}

/** Remove rake from the pots in place; returns the chips taken (0 if rake-free or no flop). */
function takeRake(state: GameState, pots: Pot[]): number {
  const pct = state.config.rakePercent ?? 0;
  if (pct <= 0 || state.board.length < 3) return 0;
  const total = pots.reduce((s, pot) => s + pot.amount, 0);
  const cap = state.config.rakeCap ?? 0;
  let rake = Math.floor(total * pct);
  if (cap > 0) rake = Math.min(rake, cap);
  // Take it proportionally from each pot (largest first to avoid zeroing tiny side pots).
  let remaining = rake;
  for (const pot of [...pots].sort((a, b) => b.amount - a.amount)) {
    if (remaining <= 0) break;
    const take = Math.min(pot.amount, Math.ceil((pot.amount / total) * rake), remaining);
    pot.amount -= take;
    remaining -= take;
  }
  return rake - remaining;
}

function netBySeat(state: GameState): Record<number, number> {
  const net: Record<number, number> = {};
  for (const p of state.players) net[p.seat] = p.stack - state.config.startingStack;
  return net;
}
