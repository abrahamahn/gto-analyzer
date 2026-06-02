import {
  type PlayerProfile,
  equityVsRanges,
  gradeDecision,
  modelVillainRange,
} from "@poker/engine";
import { rakeOf, toHand, toSpot } from "./bridge.js";
import { mulberry32 } from "./deck.js";
import { applyAction, legalActions } from "./engine.js";
import type { GameAction, GameState, LegalAction, PlayerState } from "./types.js";

/** At/above this difficulty, heads-up postflop bots play the solved GTO strategy. */
const SOLVER_DIFFICULTY = 0.85;

/**
 * For a heads-up postflop spot, ask the CFR-backed grader for this bot's GTO
 * strategy and sample an action from its frequencies. Returns null (→ heuristic)
 * when the spot isn't a solved heads-up postflop node, keeping full tables fast.
 */
function solverAction(
  state: GameState,
  seat: number,
  profiles: Map<string, PlayerProfile> | undefined,
  rng: () => number,
): GameAction | null {
  const liveVillains = state.players.filter((p) => liveVillain(p, seat));
  if (liveVillains.length !== 1 || state.street === "preflop") return null;

  const bot = state.players[seat]!;
  const hand = toHand(state, seat);
  const spot = toSpot(state, seat);
  const grade = gradeDecision({
    hand,
    decision: { spot, heroAction: { actor: bot.name, type: spot.toCallBB > 0 ? "call" : "check" } },
    profiles,
    rake: rakeOf(state.config),
  });
  if (grade.confidence !== "solved" || grade.actions.length === 0) return null;

  // Sample an action category from the GTO frequencies.
  let roll = rng();
  let chosen = grade.actions[0]!;
  for (const a of grade.actions) {
    roll -= a.frequency ?? 0;
    if (roll <= 0) {
      chosen = a;
      break;
    }
  }

  const legal = legalActions(state, seat);
  const bb = state.config.bigBlind;
  if (chosen.type === "bet" || chosen.type === "raise" || chosen.type === "all-in") {
    const agg = legal.find((l) => l.type === "bet" || l.type === "raise");
    if (!agg) return passiveFallback(seat, legal);
    const target =
      chosen.sizeBB !== undefined
        ? clampTo(Math.round(chosen.sizeBB * bb), agg)
        : clampTo(Math.round(state.currentBet + 0.66 * spot.potBB * bb), agg);
    return { seat, type: agg.type, amount: target };
  }
  if (chosen.type === "fold") {
    return legal.some((l) => l.type === "fold")
      ? { seat, type: "fold" }
      : passiveFallback(seat, legal);
  }
  return passiveFallback(seat, legal);
}

function passiveFallback(seat: number, legal: LegalAction[]): GameAction {
  return legal.some((l) => l.type === "check") ? { seat, type: "check" } : { seat, type: "call" };
}

function clampTo(target: number, agg: LegalAction): number {
  return Math.max(agg.min ?? 0, Math.min(agg.max ?? 0, target));
}

const liveVillain = (p: PlayerState, seat: number) =>
  p.seat !== seat && (p.status === "active" || p.status === "all-in");

/** Bot hand equity vs the modeled ranges of the live opponents (fast Monte Carlo). */
function estimateEquity(
  state: GameState,
  seat: number,
  profiles?: Map<string, PlayerProfile>,
): number {
  const hero = state.players[seat]!;
  if (!hero.holeCards) return 0.5;
  const hand = toHand(state, seat);
  const spot = toSpot(state, seat);
  const villainRanges = state.players
    .filter((p) => liveVillain(p, seat))
    .map((p) => modelVillainRange(hand, spot, p.name, { profile: profiles?.get(p.name) }).combos)
    .filter((c) => c.length > 0)
    .map((combos) => combos.map((c) => c.cards));
  if (villainRanges.length === 0) return 0.5;
  return equityVsRanges({
    hero: hero.holeCards,
    villainRanges,
    board: spot.board,
    iterations: 1200,
  }).equity;
}

interface DifficultyParams {
  /** Extra equity tolerance when calling — beginners call too wide. */
  callSlack: number;
  /** Equity needed to value-bet/raise. */
  valueThreshold: number;
  /** Chance to choose raise over call with a strong hand. */
  aggression: number;
  /** Chance to bluff with a weak hand when checked to / first in. */
  bluffFreq: number;
}

function params(d: number): DifficultyParams {
  const clamped = Math.max(0, Math.min(1, d));
  return {
    callSlack: 0.18 * (1 - clamped), // d=0 calls ~18% too light; d=1 obeys pot odds
    valueThreshold: 0.62 - 0.12 * clamped, // higher difficulty value-bets thinner
    aggression: 0.3 + 0.55 * clamped,
    bluffFreq: 0.05 + 0.28 * clamped, // beginners rarely bluff
  };
}

/** Decide a legal action for the bot at `seat`. Heuristic + difficulty-scaled (fast). */
export function decideAction(
  state: GameState,
  seat: number,
  profiles?: Map<string, PlayerProfile>,
): GameAction {
  const legal = legalActions(state, seat);
  if (legal.length === 0) throw new Error(`seat ${seat} cannot act`);
  const bot = state.players[seat]!;
  const p = params(bot.difficulty);
  const rng = mulberry32((state.rngState ^ (seat * 2654435761) ^ state.actions.length) >>> 0).next;

  // Strong bots solve heads-up postflop spots exactly (falls back to heuristic otherwise).
  if (bot.difficulty >= SOLVER_DIFFICULTY) {
    const solved = solverAction(state, seat, profiles, rng);
    if (solved) return solved;
  }

  const potChips = state.players.reduce((s, x) => s + x.committedThisHand, 0);
  const toCallChips = state.currentBet - bot.committedThisStreet;
  const potOdds = toCallChips > 0 ? toCallChips / (potChips + toCallChips) : 0;
  const equity = estimateEquity(state, seat, profiles);

  const aggressive = legal.find((l) => l.type === "bet" || l.type === "raise");
  const wetBonus = boardWetness(state) * 0.1;
  const sizeFrac = 0.55 + 0.2 * bot.difficulty + wetBonus;

  const raiseTo = (): number | null => {
    if (!aggressive) return null;
    const add = Math.round(sizeFrac * (potChips + Math.max(0, toCallChips)));
    const target = Math.max(state.currentBet, 0) + add;
    return Math.max(aggressive.min ?? 0, Math.min(aggressive.max ?? 0, target));
  };

  // Facing a bet: fold / call / raise.
  if (toCallChips > 0) {
    if (equity >= p.valueThreshold && aggressive && rng() < p.aggression) {
      const to = raiseTo();
      if (to !== null) return { seat, type: aggressive.type, amount: to };
    }
    if (equity >= potOdds - p.callSlack) return { seat, type: "call" };
    // Occasional bluff-raise at higher difficulty.
    if (aggressive && rng() < p.bluffFreq * 0.5) {
      const to = raiseTo();
      if (to !== null) return { seat, type: aggressive.type, amount: to };
    }
    return { seat, type: "fold" };
  }

  // No bet to face: check or bet.
  if (equity >= p.valueThreshold && aggressive) {
    const to = raiseTo();
    if (to !== null) return { seat, type: aggressive.type, amount: to };
  }
  if (aggressive && rng() < p.bluffFreq) {
    const to = raiseTo();
    if (to !== null) return { seat, type: aggressive.type, amount: to };
  }
  return legal.some((l) => l.type === "check") ? { seat, type: "check" } : { seat, type: "fold" };
}

/** Apply bot actions until it is a human's turn or the hand is complete. */
export function advanceBots(state: GameState, profiles?: Map<string, PlayerProfile>): GameState {
  let guard = 0;
  while (state.phase !== "complete" && state.toAct !== null) {
    const actor = state.players[state.toAct]!;
    if (actor.isHuman) break;
    applyAction(state, decideAction(state, state.toAct, profiles));
    if (++guard > 2000) throw new Error("bot loop did not terminate");
  }
  return state;
}

/** 0 (dry/rainbow) … ~1 (very wet) — used to size bigger on draw-heavy boards. */
function boardWetness(state: GameState): number {
  const board = state.board;
  if (board.length < 3) return 0;
  const suits = new Map<string, number>();
  const ranks = board.map((c) => "23456789TJQKA".indexOf(c.rank)).sort((a, b) => a - b);
  for (const c of board) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  const maxSuit = Math.max(...suits.values());
  const span = ranks.length ? ranks[ranks.length - 1]! - ranks[0]! : 12;
  let w = 0;
  if (maxSuit >= 2) w += 0.4;
  if (maxSuit >= 3) w += 0.3;
  if (span <= 4) w += 0.3;
  return Math.min(1, w);
}
