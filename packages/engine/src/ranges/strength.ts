import type { Card } from "@poker/shared";
import { HAND_CLASSES, rankValue } from "../handClass.js";

/**
 * Chen-formula preflop strength for a hand class ("AA", "AKs", "72o"). Used only
 * to order the 169 classes so a range can be widened or tightened to a target
 * percentage — not as an absolute EV. Higher is stronger.
 */
export function chenScore(cls: string): number {
  const hi = rankFromChar(cls[0]!);
  const lo = rankFromChar(cls[1]!);
  const suited = cls.endsWith("s");
  const pair = cls.length === 2;

  let score = highCardPoints(Math.max(hi, lo));
  if (pair) {
    score = Math.max(score * 2, 5);
    return score;
  }
  if (suited) score += 2;

  const gap = Math.abs(hi - lo) - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;

  // Straightish bonus: 0/1-gap with both cards below Q.
  if (gap <= 1 && Math.max(hi, lo) < 12) score += 1;
  return score;
}

function highCardPoints(rank: number): number {
  if (rank === 14) return 10; // A
  if (rank === 13) return 8; // K
  if (rank === 12) return 7; // Q
  if (rank === 11) return 6; // J
  return rank / 2;
}

function rankFromChar(ch: string): number {
  return rankValue(ch as Parameters<typeof rankValue>[0]);
}

/** The 169 classes ordered strongest → weakest, with a stable tiebreak. */
export const CLASSES_BY_STRENGTH: readonly string[] = [...HAND_CLASSES].sort((a, b) => {
  const d = chenScore(b) - chenScore(a);
  return d !== 0 ? d : a.localeCompare(b);
});

/** Coarse made-hand buckets on a partial/complete board, for action-based range narrowing. */
export enum MadeHand {
  Air = 0,
  WeakDraw = 1,
  StrongDraw = 2,
  WeakPair = 3,
  TopPairOrSecond = 4,
  TwoPairPlus = 5,
  Nuts = 6,
}

interface Counts {
  rankCount: Map<number, number>;
  suitCount: Map<string, number>;
}

/**
 * Classify two hole cards on a board into a coarse made-hand bucket. Cheap and
 * approximate (it does not enumerate the best five) — enough to drive "would this
 * combo bet / call / fold" filters during range narrowing.
 */
export function madeHand(hole: [Card, Card], board: Card[]): MadeHand {
  const cards = [...hole, ...board];
  const counts = tally(cards);
  const boardRanks = board.map((c) => rankValue(c.rank));
  const topBoard = boardRanks.length ? Math.max(...boardRanks) : 0;

  const pairedRanks = [...counts.rankCount.entries()].filter(([, n]) => n >= 2);
  const trips = [...counts.rankCount.entries()].filter(([, n]) => n >= 3);
  const pairs = pairedRanks.filter(([, n]) => n === 2);

  if (trips.length > 0 || pairs.length >= 2) {
    return MadeHand.TwoPairPlus;
  }

  const holeRanks = hole.map((c) => rankValue(c.rank));
  if (pairs.length === 1) {
    const pairRank = pairs[0]![0];
    const usesHole = holeRanks.includes(pairRank);
    if (usesHole && pairRank >= topBoard) return MadeHand.TopPairOrSecond;
    if (usesHole) return MadeHand.WeakPair;
    // Pocket pair below top board card.
    if (holeRanks[0] === holeRanks[1]) {
      return holeRanks[0]! >= topBoard ? MadeHand.TopPairOrSecond : MadeHand.WeakPair;
    }
    return MadeHand.WeakPair;
  }

  const draw = drawStrength(hole, board, counts);
  return draw;
}

function drawStrength(hole: [Card, Card], board: Card[], counts: Counts): MadeHand {
  const flushDraw = [...counts.suitCount.values()].some((n) => n === 4);
  if (flushDraw) return MadeHand.StrongDraw;

  const ranks = new Set([...hole, ...board].map((c) => rankValue(c.rank)));
  if (hasOpenEnder(ranks)) return MadeHand.StrongDraw;
  if (hasGutshot(ranks)) return MadeHand.WeakDraw;

  // Two overcards to a low board count as a marginal draw-ish holding.
  const boardHigh = board.length ? Math.max(...board.map((c) => rankValue(c.rank))) : 0;
  if (hole.every((c) => rankValue(c.rank) > boardHigh)) return MadeHand.WeakDraw;
  return MadeHand.Air;
}

function tally(cards: Card[]): Counts {
  const rankCount = new Map<number, number>();
  const suitCount = new Map<string, number>();
  for (const c of cards) {
    const r = rankValue(c.rank);
    rankCount.set(r, (rankCount.get(r) ?? 0) + 1);
    suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  }
  return { rankCount, suitCount };
}

function hasOpenEnder(ranks: Set<number>): boolean {
  // Four to a straight with two ways to fill (e.g. 5678) — approximate by any
  // run of 4 consecutive ranks not at the extremes.
  for (let lo = 2; lo <= 11; lo++) {
    if ([0, 1, 2, 3].every((i) => ranks.has(lo + i)) && lo >= 3 && lo + 3 <= 13) return true;
  }
  return false;
}

function hasGutshot(ranks: Set<number>): boolean {
  for (let lo = 2; lo <= 10; lo++) {
    const window = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
    const present = window.filter((r) => ranks.has(r)).length;
    if (present === 4) return true;
  }
  // Wheel draws with the ace.
  if (ranks.has(14)) {
    const present = [2, 3, 4, 5].filter((r) => ranks.has(r)).length;
    if (present >= 3) return true;
  }
  return false;
}
