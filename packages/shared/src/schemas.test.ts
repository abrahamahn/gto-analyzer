import { describe, expect, it } from "vitest";
import { HandSchema, Rank, Suit } from "./schemas.js";

describe("HandSchema", () => {
  const validHand = {
    handId: "12345",
    site: "CoinPoker",
    table: "Test Table",
    playedAt: "2026-05-29T12:00:00.000Z",
    currency: "USDT",
    smallBlind: 0.05,
    bigBlind: 0.1,
    ante: 0,
    hero: "Hero",
    heroCards: [
      { rank: Rank.Ace, suit: Suit.Spades },
      { rank: Rank.King, suit: Suit.Hearts },
    ],
    seats: [
      { seat: 1, player: "Hero", stack: 10, position: "BTN" as const },
      { seat: 2, player: "Villain", stack: 10, position: "BB" as const },
    ],
    streets: [
      {
        street: "preflop" as const,
        board: [],
        actions: [
          { actor: "Hero", type: "raise" as const, amount: 0.25 },
          { actor: "Villain", type: "call" as const, amount: 0.15 },
        ],
      },
    ],
    potTotal: 0.5,
    rake: 0.02,
    winners: [{ player: "Hero", amount: 0.48 }],
  };

  it("accepts a valid hand", () => {
    expect(() => HandSchema.parse(validHand)).not.toThrow();
  });

  it("rejects negative blinds", () => {
    expect(() => HandSchema.parse({ ...validHand, bigBlind: -1 })).toThrow();
  });

  it("rejects missing handId", () => {
    const { handId: _omit, ...rest } = validHand;
    expect(() => HandSchema.parse(rest)).toThrow();
  });
});
