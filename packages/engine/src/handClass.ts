import { type Card, Rank } from "@poker/shared";

/** Ranks high → low, the order used for the 13×13 grid (rows and columns). */
export const RANKS_DESC = [
  Rank.Ace,
  Rank.King,
  Rank.Queen,
  Rank.Jack,
  Rank.Ten,
  Rank.Nine,
  Rank.Eight,
  Rank.Seven,
  Rank.Six,
  Rank.Five,
  Rank.Four,
  Rank.Three,
  Rank.Two,
] as const;

const RANK_VALUE: Record<Rank, number> = {
  [Rank.Two]: 2,
  [Rank.Three]: 3,
  [Rank.Four]: 4,
  [Rank.Five]: 5,
  [Rank.Six]: 6,
  [Rank.Seven]: 7,
  [Rank.Eight]: 8,
  [Rank.Nine]: 9,
  [Rank.Ten]: 10,
  [Rank.Jack]: 11,
  [Rank.Queen]: 12,
  [Rank.King]: 13,
  [Rank.Ace]: 14,
};

export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

/**
 * Canonical class label for a two-card hand, ignoring specific suits:
 *   - pair        → "AA", "TT"
 *   - suited      → "AKs" (high rank first)
 *   - offsuit     → "AKo"
 */
export function handClass(a: Card, b: Card): string {
  const [hi, lo] = rankValue(a.rank) >= rankValue(b.rank) ? [a, b] : [b, a];
  if (hi.rank === lo.rank) return `${hi.rank}${lo.rank}`;
  const suited = hi.suit === lo.suit ? "s" : "o";
  return `${hi.rank}${lo.rank}${suited}`;
}

/** Number of distinct card combinations a class represents: 6 pairs, 4 suited, 12 offsuit. */
export function comboCount(cls: string): number {
  if (cls.length === 2) return 6; // pair
  return cls.endsWith("s") ? 4 : 12;
}

/** Every one of the 169 classes, ordered for the grid (row hi-rank, col lo-rank). */
export const HAND_CLASSES: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < RANKS_DESC.length; i++) {
    for (let j = 0; j < RANKS_DESC.length; j++) {
      const hi = RANKS_DESC[i]!;
      const lo = RANKS_DESC[j]!;
      if (i === j) out.push(`${hi}${lo}`); // pair (on the diagonal)
      else if (i < j) out.push(`${hi}${lo}s`); // suited (upper-right)
      else out.push(`${lo}${hi}o`); // offsuit (lower-left)
    }
  }
  return out;
})();

const TOTAL_COMBOS = 1326; // C(52,2)

/** Fraction of all starting hands (0–1) covered by a class → weight map. */
export function rangePercent(weights: Record<string, number>): number {
  let combos = 0;
  for (const [cls, freq] of Object.entries(weights)) {
    combos += comboCount(cls) * freq;
  }
  return combos / TOTAL_COMBOS;
}
