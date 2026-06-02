import { type Card, Rank, Suit, formatCard } from "@poker/shared";
import type { RangeWeights } from "./range.js";

const SUITS: readonly Suit[] = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];
const RANK_BY_CHAR = new Map<string, Rank>(Object.values(Rank).map((r) => [r, r]));

/** A specific two-card holding with the weight inherited from its range class. */
export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
}

function rankFromChar(ch: string | undefined): Rank | undefined {
  return ch ? RANK_BY_CHAR.get(ch) : undefined;
}

/** Every concrete two-card combo a class label ("AA", "AKs", "AKo") expands to. */
export function combosForClass(cls: string): Array<[Card, Card]> {
  const r1 = rankFromChar(cls[0]);
  const r2 = rankFromChar(cls[1]);
  if (!r1 || !r2) return [];

  if (r1 === r2) {
    const pairs: Array<[Card, Card]> = [];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        pairs.push([
          { rank: r1, suit: SUITS[i]! },
          { rank: r2, suit: SUITS[j]! },
        ]);
      }
    }
    return pairs;
  }

  const suffix = cls.slice(2);
  if (suffix !== "s" && suffix !== "o") return [];
  const combos: Array<[Card, Card]> = [];
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (suffix === "s" && s1 !== s2) continue;
      if (suffix === "o" && s1 === s2) continue;
      combos.push([
        { rank: r1, suit: s1 },
        { rank: r2, suit: s2 },
      ]);
    }
  }
  return combos;
}

/**
 * Expand a class→weight range into concrete weighted combos, dropping any combo
 * blocked by a dead card (hero hole cards, board). Each combo carries its class
 * weight; the rollout/equity samplers use the weight for proportional sampling.
 */
export function expandRangeToCombos(range: RangeWeights, deadCards: Card[]): WeightedCombo[] {
  const dead = new Set(deadCards.map(formatCard));
  const out: WeightedCombo[] = [];
  for (const [cls, weight] of Object.entries(range)) {
    if (weight <= 0) continue;
    for (const cards of combosForClass(cls)) {
      if (dead.has(formatCard(cards[0])) || dead.has(formatCard(cards[1]))) continue;
      out.push({ cards, weight });
    }
  }
  return out;
}
