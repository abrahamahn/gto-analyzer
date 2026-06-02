import { evaluate7, rankValue } from "@poker/engine";
import { type Card, Suit } from "@poker/shared";
import type { PlayerState, Pot, PotResult } from "./types.js";

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};

const CATEGORY = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

function score7(hole: [Card, Card], board: Card[]): number {
  return evaluate7(
    [...hole, ...board].map((c) => ({ rank: rankValue(c.rank), suit: SUIT_INDEX[c.suit] })),
  );
}

function category(score: number): string {
  return CATEGORY[(score >> 20) & 0xf] ?? "High Card";
}

/**
 * Build the main and side pots from every player's whole-hand contribution.
 * Folded players' chips stay in the pot (dead money) but they are not eligible
 * to win. Layers form at each distinct all-in level.
 */
export function buildPots(players: PlayerState[]): Pot[] {
  const remaining = players
    .filter((p) => p.committedThisHand > 0)
    .map((p) => ({ seat: p.seat, contrib: p.committedThisHand, folded: p.status === "folded" }));

  const pots: Pot[] = [];
  while (remaining.some((r) => r.contrib > 0)) {
    const min = Math.min(...remaining.filter((r) => r.contrib > 0).map((r) => r.contrib));
    const contributors = remaining.filter((r) => r.contrib > 0);
    const amount = min * contributors.length;
    const eligible = contributors.filter((r) => !r.folded).map((r) => r.seat);
    for (const r of contributors) r.contrib -= min;
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  return pots;
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Award each pot to the best eligible hand, splitting ties and distributing odd
 * chips one at a time starting from the first seat left of the button (TDA).
 * Mutates player stacks; returns per-pot results.
 */
export function awardPots(
  pots: Pot[],
  players: PlayerState[],
  board: Card[],
  buttonSeat: number,
): { results: PotResult[]; shown: number[] } {
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const results: PotResult[] = [];
  const shown = new Set<number>();

  for (const pot of pots) {
    const contenders = pot.eligible
      .map((seat) => bySeat.get(seat))
      .filter((p): p is PlayerState => !!p && !!p.holeCards);
    if (contenders.length === 0) continue;

    let best = -1;
    let winners: PlayerState[] = [];
    for (const p of contenders) {
      const s = score7(p.holeCards!, board);
      if (s > best) {
        best = s;
        winners = [p];
      } else if (s === best) {
        winners.push(p);
      }
    }
    // Multiway pots reveal contenders' cards.
    if (pot.eligible.length > 1) for (const p of contenders) shown.add(p.seat);

    const order = (seat: number) => (seat - buttonSeat - 1 + players.length * 2) % players.length;
    const sortedWinners = [...winners].sort((a, b) => order(a.seat) - order(b.seat));
    const share = Math.floor(pot.amount / sortedWinners.length);
    let odd = pot.amount - share * sortedWinners.length;
    for (const w of sortedWinners) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      w.stack += share + extra;
    }
    results.push({
      amount: pot.amount,
      winners: sortedWinners.map((w) => w.seat),
      description: category(best),
    });
  }
  return { results, shown: [...shown] };
}
