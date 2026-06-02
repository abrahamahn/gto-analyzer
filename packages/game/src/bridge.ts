import type { Rake } from "@poker/engine";
import type { Action, Hand, Position, Spot, Street } from "@poker/shared";
import type { GameAction, GameConfig, GameState, PlayerState } from "./types.js";

/** The engine-level rake model derived from a game's config (undefined = rake-free). */
export function rakeOf(config: GameConfig): Rake | undefined {
  if (!config.rakePercent || config.rakePercent <= 0) return undefined;
  return { percent: config.rakePercent, capBB: (config.rakeCap ?? 0) / config.bigBlind };
}

/** Button-relative seat → position, matching the parser's table layouts (index 0 = BTN). */
const POSITION_BY_SIZE: Record<number, Position[]> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  7: ["BTN", "SB", "BB", "UTG", "MP", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "MP", "LJ", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "MP", "MP", "LJ", "HJ", "CO"],
};

export function positionOf(seat: number, buttonSeat: number, seats: number): Position {
  const offset = (seat - buttonSeat + seats) % seats;
  const layout = POSITION_BY_SIZE[seats] ?? POSITION_BY_SIZE[9]!;
  return layout[offset] ?? "MP";
}

function convertAction(state: GameState, a: GameAction): Action {
  const name = state.players[a.seat]!.name;
  return a.amount !== undefined
    ? { actor: name, type: a.type, amount: a.amount }
    : { actor: name, type: a.type };
}

function boardForStreet(street: Street, board: GameState["board"]): GameState["board"] {
  if (street === "preflop") return [];
  if (street === "flop") return board.slice(0, 3);
  if (street === "turn") return board.slice(0, 4);
  return board.slice(0, 5);
}

/** All of this hand's actions so far, across streets, in order (excludes blind posts). */
export function priorActions(state: GameState): Action[] {
  const fromHistory = state.history.flatMap((h) => h.actions.map((a) => convertAction(state, a)));
  const last = state.history[state.history.length - 1];
  const currentInHistory = last?.street === state.street;
  const current = currentInHistory ? [] : state.actions.map((a) => convertAction(state, a));
  return [...fromHistory, ...current];
}

/**
 * Reconstruct a shared `Hand` from the live game, with `heroSeat` as the hero —
 * so the engine's range model / grader (which key off `hand.hero`) can run on the
 * in-progress game. Streets reflect actions taken so far.
 */
export function toHand(state: GameState, heroSeat: number): Hand {
  const { config } = state;
  const hero = state.players[heroSeat]!;
  const streets = state.history.map((h) => ({
    street: h.street,
    board: boardForStreet(h.street, h.board.length ? h.board : state.board),
    actions: h.actions.map((a) => convertAction(state, a)),
  }));
  const last = state.history[state.history.length - 1];
  if (last?.street !== state.street) {
    streets.push({
      street: state.street,
      board: boardForStreet(state.street, state.board),
      actions: state.actions.map((a) => convertAction(state, a)),
    });
  }

  return {
    handId: `live-${state.handNumber}`,
    site: "CoinPoker",
    table: "live",
    playedAt: new Date().toISOString(),
    currency: "PLAY",
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante: config.ante,
    hero: hero.name,
    heroCards: hero.holeCards,
    seats: state.players.map((p) => ({
      seat: p.seat,
      player: p.name,
      stack: config.startingStack,
      position: positionOf(p.seat, state.buttonSeat, state.players.length),
    })),
    streets,
    potTotal: state.players.reduce((s, p) => s + p.committedThisHand, 0),
    rake: 0,
    winners: [],
  };
}

const liveVillain = (p: PlayerState, heroSeat: number) =>
  p.seat !== heroSeat && (p.status === "active" || p.status === "all-in");

/** The current decision spot for `heroSeat` (must be their turn with cards dealt). */
export function toSpot(state: GameState, heroSeat: number): Spot {
  const hero = state.players[heroSeat]!;
  if (!hero.holeCards) throw new Error("hero has no cards");
  const bb = state.config.bigBlind;
  const pot = state.players.reduce((s, p) => s + p.committedThisHand, 0);
  const toCall = Math.max(0, state.currentBet - hero.committedThisStreet);
  const villainStacks = state.players.filter((p) => liveVillain(p, heroSeat)).map((p) => p.stack);
  const effective = villainStacks.length
    ? Math.min(hero.stack, Math.max(...villainStacks))
    : hero.stack;

  return {
    handId: `live-${state.handNumber}`,
    street: state.street,
    actionIndex: state.actions.length,
    heroPosition: positionOf(heroSeat, state.buttonSeat, state.players.length),
    effectiveStackBB: Math.max(effective / bb, 1e-9),
    potBB: pot / bb,
    toCallBB: toCall / bb,
    board: state.board,
    heroCards: hero.holeCards,
    priorActions: priorActions(state),
  };
}
