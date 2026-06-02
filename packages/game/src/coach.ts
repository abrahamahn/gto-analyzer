import {
  type PlayerProfile,
  equityVsRanges,
  evaluate7,
  gradeDecision,
  modelVillainRange,
  rankValue,
} from "@poker/engine";
import type { Card, GradeAction, GradeConfidence } from "@poker/shared";
import { Suit } from "@poker/shared";
import { rakeOf, toHand, toSpot } from "./bridge.js";
import type { GameActionType, GameState, PlayerState } from "./types.js";

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};
const cardEnc = (c: Card) => ({ rank: rankValue(c.rank), suit: SUIT_INDEX[c.suit] });
const cardId = (c: Card) => rankValue(c.rank) * 4 + SUIT_INDEX[c.suit];
const categoryOf = (score: number) => (score >> 20) & 0xf;

/** One labelled teaching factor for the "full breakdown" panel. */
export interface CoachFactor {
  label: string;
  value: string;
  detail: string;
}

export interface CoachAdvice {
  recommendation: { action: GameActionType; sizeBB?: number; reason: string };
  actions: GradeAction[];
  factors: CoachFactor[];
  confidence: GradeConfidence;
}

const liveVillain = (p: PlayerState, heroSeat: number) =>
  p.seat !== heroSeat && (p.status === "active" || p.status === "all-in");

export function coachAdvice(
  state: GameState,
  heroSeat: number,
  profiles?: Map<string, PlayerProfile>,
): CoachAdvice {
  const hand = toHand(state, heroSeat);
  const spot = toSpot(state, heroSeat);
  const hero = state.players[heroSeat]!;

  const heroAction = {
    actor: hero.name,
    type: spot.toCallBB > 0 ? ("call" as const) : ("check" as const),
  };
  const grade = gradeDecision({
    hand,
    decision: { spot, heroAction },
    profiles,
    rake: rakeOf(state.config),
  });

  // Recommendation = highest-EV legal option.
  const best = grade.actions.reduce((b, a) => (!b || a.evBB > b.evBB ? a : b), grade.actions[0]);
  const recAction = (best?.type ?? heroAction.type) as GameActionType;

  const factors = buildFactors(state, heroSeat, hand, spot, grade.actions, profiles);
  const reason = buildReason(recAction, best, factors);

  return {
    recommendation: { action: recAction, sizeBB: best?.sizeBB, reason },
    actions: grade.actions,
    factors,
    confidence: grade.confidence,
  };
}

function buildFactors(
  state: GameState,
  heroSeat: number,
  hand: ReturnType<typeof toHand>,
  spot: ReturnType<typeof toSpot>,
  actions: GradeAction[],
  profiles?: Map<string, PlayerProfile>,
): CoachFactor[] {
  const factors: CoachFactor[] = [];
  const hero = state.players[heroSeat]!;
  const pot = spot.potBB;
  const toCall = spot.toCallBB;

  // Equity vs the modeled range(s).
  const villainRanges = state.players
    .filter((p) => liveVillain(p, heroSeat))
    .map((p) => modelVillainRange(hand, spot, p.name, { profile: profiles?.get(p.name) }).combos)
    .filter((c) => c.length > 0)
    .map((combos) => combos.map((c) => c.cards));
  let equity: number | null = null;
  if (villainRanges.length > 0 && hero.holeCards) {
    equity = equityVsRanges({
      hero: hero.holeCards,
      villainRanges,
      board: spot.board,
      iterations: 4000,
    }).equity;
    factors.push({
      label: "Equity",
      value: `${Math.round(equity * 100)}%`,
      detail: `Your share of the pot vs ${villainRanges.length === 1 ? "their" : "the field's"} likely range at showdown.`,
    });
  }

  // Pot odds / price to call.
  if (toCall > 0) {
    const breakeven = toCall / (pot + toCall);
    factors.push({
      label: "Pot odds",
      value: `${Math.round(breakeven * 100)}%`,
      detail: `You risk ${toCall.toFixed(1)}bb to win ${pot.toFixed(1)}bb — you need at least this much equity to call profitably.`,
    });
    const mdf = pot / (pot + toCall);
    factors.push({
      label: "MDF",
      value: `${Math.round(mdf * 100)}%`,
      detail:
        "To stop them auto-profiting with bluffs, your whole range should defend about this often.",
    });
    // Implied odds: if you're short on direct price but still drawing, how much
    // extra you must win on later streets when you hit for the call to break even.
    if (equity !== null && equity < breakeven && equity > 0.02) {
      const extra = toCall / equity - (pot + toCall);
      if (extra > 0.1) {
        factors.push({
          label: "Implied odds",
          value: `+${extra.toFixed(1)}bb`,
          detail: `Direct price falls short — calling only pays if you win about ${extra.toFixed(1)}bb more on later streets when you hit.`,
        });
      }
    }
  }

  // SPR & effective stack — how committed you are.
  const spr = pot > 0 ? spot.effectiveStackBB / pot : Number.POSITIVE_INFINITY;
  factors.push({
    label: "SPR",
    value: Number.isFinite(spr) ? spr.toFixed(1) : "—",
    detail:
      spr <= 3
        ? "Low SPR — one pair / top pair is often a stack-off."
        : spr >= 8
          ? "High SPR — you need a strong hand to play a big pot."
          : "Medium SPR — favours strong made hands and good draws.",
  });
  factors.push({
    label: "Eff. stack",
    value: `${spot.effectiveStackBB.toFixed(0)}bb`,
    detail: "The most you (or they) can lose this hand — only the smaller stack is at risk.",
  });

  // Commitment: low SPR with a strong hand means you're getting it in regardless.
  if (equity !== null && Number.isFinite(spr)) {
    const committed = spr <= 2 && equity >= 0.6;
    if (committed) {
      factors.push({
        label: "Commitment",
        value: "committed",
        detail: `With SPR ${spr.toFixed(1)} and ${Math.round(equity * 100)}% equity you're priced in — plan to get all the chips in rather than fold later.`,
      });
    } else if (spr <= 1.5) {
      factors.push({
        label: "Commitment",
        value: "near-committed",
        detail:
          "SPR is very low — once you continue you're usually playing for stacks; decide now.",
      });
    }
  }

  // Rake — make it explicit that the EVs above already subtract it.
  const rakePct = state.config.rakePercent ?? 0;
  if (rakePct > 0) {
    const cap = state.config.rakeCap ?? 0;
    factors.push({
      label: "Rake",
      value: `${Math.round(rakePct * 100)}%`,
      detail: `House takes ${Math.round(rakePct * 100)}% of pots that see a flop${cap > 0 ? ` (cap ${cap})` : ""}. The EVs above already subtract it, which tightens thin calls and value bets.`,
    });
  }

  // Fold equity from the aggressive option, when available.
  const aggressive = actions.find(
    (a) => (a.type === "bet" || a.type === "raise") && a.villainFoldPct !== undefined,
  );
  if (aggressive?.villainFoldPct !== undefined) {
    const size = aggressive.sizeBB ?? 0;
    const breakEvenBluff = size > 0 ? size / (pot + size) : 0;
    factors.push({
      label: "Fold equity",
      value: `${Math.round(aggressive.villainFoldPct * 100)}%`,
      detail: `How often they fold to your ${aggressive.type}. A bluff needs them to fold ≥ ${Math.round(breakEvenBluff * 100)}% to print.`,
    });
  }

  // Outs to improve (flop & turn only).
  if (hero.holeCards && (spot.board.length === 3 || spot.board.length === 4)) {
    const outs = estimateOuts(hero.holeCards, spot.board);
    if (outs > 0) {
      const perCard = spot.board.length === 3 ? outs * 4 : outs * 2; // rule of 4 / 2
      factors.push({
        label: "Outs",
        value: `${outs}`,
        detail: `Cards that make you two pair or better → roughly ${perCard}% to get there by the river (rule of ${spot.board.length === 3 ? "4" : "2"}).`,
      });
    }
  }

  // Position.
  const lastAggressor = state.lastAggressor;
  const inPosition = lastAggressor === null || seatActsAfter(state, heroSeat, lastAggressor);
  factors.push({
    label: "Position",
    value: inPosition ? "In position" : "Out of position",
    detail: inPosition
      ? "You act after them on later streets — worth real EV; you can realize more of your equity."
      : "You act first — you realize less of your equity, so play a bit tighter.",
  });

  // Board texture & blockers.
  if (spot.board.length >= 3) {
    factors.push({ label: "Board", value: texture(spot.board), detail: textureDetail(spot.board) });
    const blockerNote = blockers(hero.holeCards, spot.board);
    if (blockerNote) factors.push({ label: "Blockers", value: "yes", detail: blockerNote });
  }

  return factors;
}

// Two Pair in the engine's category packing; weaker improvements (a bare pair)
// aren't counted as "outs" because they rarely become the winning hand.
const MIN_MEANINGFUL_CATEGORY = 2;

/** Cards that improve hero to two pair or better (a straight/flush/trips/etc.). */
function estimateOuts(hole: [Card, Card], board: Card[]): number {
  const used = new Set([...hole, ...board].map(cardId));
  const current = categoryOf(evaluate7([...hole, ...board].map(cardEnc)));
  let outs = 0;
  for (let id = 0; id < 52; id++) {
    if (used.has(id)) continue;
    const c = decodeId(id);
    const cat = categoryOf(evaluate7([...hole, ...board, c].map(cardEnc)));
    if (cat > current && cat >= MIN_MEANINGFUL_CATEGORY) outs++;
  }
  return outs;
}

function decodeId(id: number): Card {
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const suits = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];
  return { rank: ranks[Math.floor(id / 4) - 2] as Card["rank"], suit: suits[id % 4]! };
}

function texture(board: Card[]): string {
  const suitCounts = new Map<Suit, number>();
  const rankCounts = new Map<number, number>();
  for (const c of board) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    rankCounts.set(rankValue(c.rank), (rankCounts.get(rankValue(c.rank)) ?? 0) + 1);
  }
  const maxSuit = Math.max(...suitCounts.values());
  const paired = [...rankCounts.values()].some((n) => n >= 2);
  if (maxSuit >= 3) return "monotone";
  if (paired) return "paired";
  if (maxSuit === 2) return "two-tone";
  return "rainbow";
}

function textureDetail(board: Card[]): string {
  const t = texture(board);
  if (t === "monotone") return "Three of a suit — flushes are live; proceed carefully without one.";
  if (t === "paired") return "A pair on board — full houses possible; bluffs work less well.";
  if (t === "two-tone") return "A flush draw is out there — bet bigger to charge draws.";
  return "Dry board — favours the preflop aggressor; small bets do the job.";
}

function blockers(hole: [Card, Card] | null, board: Card[]): string | null {
  if (!hole) return null;
  const boardRanks = new Set(board.map((c) => c.rank));
  const matches = hole.filter((c) => boardRanks.has(c.rank));
  if (matches.length > 0) {
    return `You hold ${matches.map((c) => c.rank).join("/")} that pairs the board — it blocks some of their two-pair/trips combos.`;
  }
  return null;
}

function seatActsAfter(state: GameState, seat: number, other: number): boolean {
  // Postflop the action starts left of the button (SB first) and the button acts
  // last, so order by distance after the button — higher = later = in position.
  const n = state.players.length;
  const rel = (s: number) => (s - state.buttonSeat - 1 + n) % n;
  return rel(seat) > rel(other);
}

function buildReason(
  action: GameActionType,
  best: GradeAction | undefined,
  factors: CoachFactor[],
): string {
  const eq = factors.find((f) => f.label === "Equity")?.value;
  const odds = factors.find((f) => f.label === "Pot odds")?.value;
  const fe = factors.find((f) => f.label === "Fold equity")?.value;
  const ev = best ? `${best.evBB >= 0 ? "+" : ""}${best.evBB.toFixed(2)}bb` : "";
  const bits: string[] = [];
  if (eq) bits.push(`${eq} equity`);
  if (odds && (action === "call" || action === "fold")) bits.push(`price ${odds}`);
  if (fe && (action === "bet" || action === "raise")) bits.push(`${fe} fold equity`);
  const verb =
    action === "fold"
      ? "Fold"
      : action === "check"
        ? "Check"
        : action === "call"
          ? "Call"
          : action === "bet"
            ? `Bet${best?.sizeBB ? ` ${best.sizeBB.toFixed(1)}bb` : ""}`
            : `Raise${best?.sizeBB ? ` to ${best.sizeBB.toFixed(1)}bb` : ""}`;
  return `${verb} (${ev})${bits.length ? ` — ${bits.join(", ")}` : ""}.`;
}
