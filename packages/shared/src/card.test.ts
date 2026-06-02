import { describe, expect, it } from "vitest";
import { RANKS, SUITS, formatCard, parseCard } from "./card.js";

describe("card", () => {
  it("round-trips every card in the deck", () => {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        const card = { rank, suit };
        expect(parseCard(formatCard(card))).toEqual(card);
      }
    }
  });

  it("accepts mixed case", () => {
    expect(parseCard("as")).toEqual(parseCard("As"));
    expect(parseCard("TD")).toEqual(parseCard("Td"));
  });

  it("rejects invalid input", () => {
    expect(() => parseCard("")).toThrow();
    expect(() => parseCard("Ass")).toThrow();
    expect(() => parseCard("Xs")).toThrow();
    expect(() => parseCard("Az")).toThrow();
  });
});
