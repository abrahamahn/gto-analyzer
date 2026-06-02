import { type Card, RANKS, SUITS } from "@poker/shared";

/** Deterministic PRNG so games are reproducible from a seed. */
export function mulberry32(seed: number): { next: () => number; state: () => number } {
  let t = seed >>> 0;
  return {
    next: () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
    state: () => t >>> 0,
  };
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher–Yates shuffle in place using the supplied PRNG. */
export function shuffle(deck: Card[], rng: () => number): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
