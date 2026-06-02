import { type Card, Rank, Suit } from "@poker/shared";
import { rankValue } from "./handClass.js";

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  equity: number; // average share of the pot hero realizes at showdown
  iterations: number;
}

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};

interface Encoded {
  rank: number; // 2..14
  suit: number; // 0..3
}

function encode(card: Card): Encoded {
  return { rank: rankValue(card.rank), suit: SUIT_INDEX[card.suit] };
}

function cardKey(c: Encoded): number {
  return c.rank * 4 + c.suit;
}

/** Highest card of a 5-in-a-row in a rank set (Ace counts high and low), or 0. */
function straightHigh(rankBits: number): number {
  // Add a synthetic low-ace bit (rank 1) when the ace is present, for A-2-3-4-5.
  let bits = rankBits;
  if (rankBits & (1 << 14)) bits |= 1 << 1;
  for (let high = 14; high >= 5; high--) {
    let run = true;
    for (let r = high; r > high - 5; r--) {
      if ((bits & (1 << r)) === 0) {
        run = false;
        break;
      }
    }
    if (run) return high;
  }
  return 0;
}

const CAT_STRAIGHT_FLUSH = 8;
const CAT_QUADS = 7;
const CAT_FULL_HOUSE = 6;
const CAT_FLUSH = 5;
const CAT_STRAIGHT = 4;
const CAT_TRIPS = 3;
const CAT_TWO_PAIR = 2;
const CAT_PAIR = 1;
const CAT_HIGH = 0;

function pack(cat: number, t: number[]): number {
  // 4 bits per field: category then up to five tiebreak ranks (each ≤ 14).
  let score = cat;
  for (let i = 0; i < 5; i++) score = (score << 4) | (t[i] ?? 0);
  return score;
}

/** Score the best 5-card hand out of exactly 7 cards. Higher is better. */
export function evaluate7(cards: Encoded[]): number {
  const rankCount = new Array<number>(15).fill(0);
  const suitRanks: number[] = [0, 0, 0, 0]; // per-suit rank bitmask
  let rankBits = 0;
  for (const c of cards) {
    rankCount[c.rank]!++;
    suitRanks[c.suit]! |= 1 << c.rank;
    rankBits |= 1 << c.rank;
  }

  // Flush / straight flush.
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (popcount(suitRanks[s]!) >= 5) flushSuit = s;
  }
  if (flushSuit >= 0) {
    const sf = straightHigh(suitRanks[flushSuit]!);
    if (sf > 0) return pack(CAT_STRAIGHT_FLUSH, [sf]);
  }

  // Group ranks by count, high → low.
  const byCount: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (let r = 14; r >= 2; r--) {
    const c = rankCount[r]!;
    if (c > 0) byCount[c]!.push(r);
  }

  if (byCount[4]!.length > 0) {
    const quad = byCount[4]![0]!;
    const kicker = highestExcept(rankBits, [quad]);
    return pack(CAT_QUADS, [quad, kicker]);
  }

  const trips = byCount[3]!;
  const pairs = byCount[2]!;
  if (trips.length >= 2) {
    return pack(CAT_FULL_HOUSE, [trips[0]!, trips[1]!]);
  }
  if (trips.length === 1 && pairs.length >= 1) {
    return pack(CAT_FULL_HOUSE, [trips[0]!, pairs[0]!]);
  }

  if (flushSuit >= 0) {
    const top = topRanks(suitRanks[flushSuit]!, 5);
    return pack(CAT_FLUSH, top);
  }

  const st = straightHigh(rankBits);
  if (st > 0) return pack(CAT_STRAIGHT, [st]);

  if (trips.length === 1) {
    const kickers = topRanks(rankBits & ~(1 << trips[0]!), 2);
    return pack(CAT_TRIPS, [trips[0]!, ...kickers]);
  }
  if (pairs.length >= 2) {
    const [hi, lo] = [pairs[0]!, pairs[1]!];
    const kicker = highestExcept(rankBits, [hi, lo]);
    return pack(CAT_TWO_PAIR, [hi, lo, kicker]);
  }
  if (pairs.length === 1) {
    const kickers = topRanks(rankBits & ~(1 << pairs[0]!), 3);
    return pack(CAT_PAIR, [pairs[0]!, ...kickers]);
  }
  return pack(CAT_HIGH, topRanks(rankBits, 5));
}

function popcount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

function topRanks(bits: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < n; r--) {
    if (bits & (1 << r)) out.push(r);
  }
  return out;
}

function highestExcept(bits: number, exclude: number[]): number {
  let masked = bits;
  for (const e of exclude) masked &= ~(1 << e);
  return topRanks(masked, 1)[0] ?? 0;
}

const FULL_DECK: Encoded[] = (() => {
  const ranks = Object.values(Rank);
  const suits = Object.values(Suit);
  const deck: Encoded[] = [];
  for (const r of ranks)
    for (const s of suits) deck.push({ rank: rankValue(r), suit: SUIT_INDEX[s] });
  return deck;
})();

/**
 * Hero equity against a villain range on a (possibly partial) board, by
 * Monte Carlo: sample a legal villain combo and complete the board, score the
 * showdown, repeat. Deterministic-enough at the default iteration count for
 * grading thresholds; raise `iterations` for tighter confidence.
 */
export function equityVsRange(args: {
  hero: [Card, Card];
  villainRange: Array<[Card, Card]>;
  board: Card[];
  iterations?: number;
}): EquityResult {
  return equityVsRanges({
    hero: args.hero,
    villainRanges: [args.villainRange],
    board: args.board,
    iterations: args.iterations,
  });
}

/** Hero equity against one or more villain ranges, sampling legal non-overlapping combos. */
export function equityVsRanges(args: {
  hero: [Card, Card];
  villainRanges: Array<Array<[Card, Card]>>;
  board: Card[];
  iterations?: number;
}): EquityResult {
  const iterations = args.iterations ?? 10000;
  const hero = args.hero.map(encode);
  const board = args.board.map(encode);
  const villainRanges = args.villainRanges.map((range) =>
    range.map(([a, b]) => [encode(a), encode(b)] as const),
  );
  if (villainRanges.length === 0) throw new Error("equityVsRanges: no villain ranges");
  if (villainRanges.some((range) => range.length === 0)) {
    throw new Error("equityVsRanges: empty villain range");
  }

  const used = new Set<number>([...hero, ...board].map(cardKey));

  let win = 0;
  let tie = 0;
  let lose = 0;
  let equity = 0;
  let counted = 0;

  for (let it = 0; it < iterations; it++) {
    const taken = new Set(used);
    const villains: Array<readonly [Encoded, Encoded]> = [];
    let valid = true;

    for (const range of villainRanges) {
      const combo = sampleUnblockedCombo(range, taken);
      if (!combo) {
        valid = false;
        break;
      }
      taken.add(cardKey(combo[0]));
      taken.add(cardKey(combo[1]));
      villains.push(combo);
    }
    if (!valid) continue;

    const runout = [...board];
    while (runout.length < 5) {
      const c = FULL_DECK[(Math.random() * FULL_DECK.length) | 0]!;
      const k = cardKey(c);
      if (taken.has(k)) continue;
      taken.add(k);
      runout.push(c);
    }

    const heroScore = evaluate7([...hero, ...runout]);
    const villainScores = villains.map(([v0, v1]) => evaluate7([v0, v1, ...runout]));
    const bestVillainScore = Math.max(...villainScores);
    if (heroScore > bestVillainScore) {
      win++;
      equity += 1;
    } else if (heroScore < bestVillainScore) {
      lose++;
    } else {
      const tiedVillains = villainScores.filter((score) => score === heroScore).length;
      tie++;
      equity += 1 / (tiedVillains + 1);
    }
    counted++;
  }

  if (counted === 0) {
    return { win: 0, tie: 0, lose: 0, equity: 0, iterations: 0 };
  }
  const w = win / counted;
  const t = tie / counted;
  return { win: w, tie: t, lose: lose / counted, equity: equity / counted, iterations: counted };
}

function sampleUnblockedCombo(
  range: Array<readonly [Encoded, Encoded]>,
  taken: Set<number>,
): readonly [Encoded, Encoded] | undefined {
  for (let attempts = 0; attempts < 80; attempts++) {
    const combo = range[(Math.random() * range.length) | 0]!;
    if (!taken.has(cardKey(combo[0])) && !taken.has(cardKey(combo[1]))) return combo;
  }
  return range.find((combo) => !taken.has(cardKey(combo[0])) && !taken.has(cardKey(combo[1])));
}
