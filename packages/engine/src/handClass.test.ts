import { Rank, Suit } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { HAND_CLASSES, comboCount, handClass, rangePercent } from "./handClass.js";

const c = (rank: Rank, suit: Suit) => ({ rank, suit });

describe("handClass", () => {
  it("labels pairs without a suit suffix", () => {
    expect(handClass(c(Rank.Ace, Suit.Clubs), c(Rank.Ace, Suit.Spades))).toBe("AA");
  });

  it("orders the high card first and marks suitedness", () => {
    expect(handClass(c(Rank.King, Suit.Hearts), c(Rank.Ace, Suit.Hearts))).toBe("AKs");
    expect(handClass(c(Rank.King, Suit.Hearts), c(Rank.Ace, Suit.Spades))).toBe("AKo");
  });
});

describe("HAND_CLASSES", () => {
  it("enumerates exactly 169 distinct classes", () => {
    expect(HAND_CLASSES).toHaveLength(169);
    expect(new Set(HAND_CLASSES).size).toBe(169);
  });

  it("covers all 1326 combos", () => {
    const total = HAND_CLASSES.reduce((s, cls) => s + comboCount(cls), 0);
    expect(total).toBe(1326);
  });
});

describe("rangePercent", () => {
  it("counts a full range as 100%", () => {
    const all = Object.fromEntries(HAND_CLASSES.map((cls) => [cls, 1]));
    expect(rangePercent(all)).toBeCloseTo(1, 10);
  });

  it("weights pairs as 6 combos each", () => {
    expect(rangePercent({ AA: 1 })).toBeCloseTo(6 / 1326, 10);
  });
});
