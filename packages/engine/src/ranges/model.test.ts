import type { Hand, Spot } from "@poker/shared";
import { parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { loadDefaultCharts } from "../charts/data.js";
import { modelVillainRange } from "./model.js";
import { buildProfiles } from "./profile.js";

loadDefaultCharts();

function handWithBtnOpen(): Hand {
  return {
    handId: "h1",
    site: "CoinPoker",
    table: "t1",
    playedAt: "2026-05-21T02:30:19.000Z",
    currency: "USDT",
    smallBlind: 0.01,
    bigBlind: 0.02,
    ante: 0,
    hero: "Hero",
    heroCards: [parseCard("As"), parseCard("Kd")],
    seats: [
      { seat: 1, player: "SB", stack: 2, position: "SB" },
      { seat: 2, player: "Hero", stack: 2, position: "BB" },
      { seat: 3, player: "BTN", stack: 2, position: "BTN" },
    ],
    streets: [
      {
        street: "preflop",
        board: [],
        actions: [
          { actor: "SB", type: "post-sb", amount: 0.01 },
          { actor: "Hero", type: "post-bb", amount: 0.02 },
          { actor: "BTN", type: "raise", amount: 0.05 },
          { actor: "SB", type: "fold" },
          { actor: "Hero", type: "call", amount: 0.03 },
        ],
      },
    ],
    potTotal: 0,
    rake: 0,
    winners: [],
  };
}

const heroBbSpot: Spot = {
  handId: "h1",
  street: "preflop",
  actionIndex: 4,
  heroPosition: "BB",
  effectiveStackBB: 99,
  potBB: 4,
  toCallBB: 1.5,
  board: [],
  heroCards: [parseCard("As"), parseCard("Kd")],
  priorActions: [],
};

describe("modelVillainRange", () => {
  it("seeds a BTN open from the shipped RFI chart", () => {
    const range = modelVillainRange(handWithBtnOpen(), heroBbSpot, "BTN");
    expect(range.role).toBe("rfi");
    expect(range.source).toBe("chart");
    expect(range.combos.length).toBeGreaterThan(100);
    // Hero holds A/K, so no combo may reuse those exact cards.
    const dead = new Set(["As", "Kd"]);
    for (const c of range.combos) {
      expect(dead.has(`${c.cards[0].rank}${c.cards[0].suit}`)).toBe(false);
      expect(dead.has(`${c.cards[1].rank}${c.cards[1].suit}`)).toBe(false);
    }
  });

  it("returns an empty range for a player who folded preflop", () => {
    const hand = handWithBtnOpen();
    hand.streets[0]!.actions = [
      { actor: "SB", type: "post-sb", amount: 0.01 },
      { actor: "Hero", type: "post-bb", amount: 0.02 },
      { actor: "BTN", type: "fold" },
    ];
    const range = modelVillainRange(hand, heroBbSpot, "BTN");
    expect(range.role).toBe("folded");
    expect(range.combos).toEqual([]);
  });

  it("widens the modeled range for a loose-aggressive player given enough samples", () => {
    const looseHands: Hand[] = [];
    const tightHands: Hand[] = [];
    // Fabricate histories: 'BTN' opens (PFR) 80% loose vs 10% tight over 200 hands.
    for (let i = 0; i < 200; i++) {
      const open = (frac: number): Hand => {
        const h = handWithBtnOpen();
        h.handId = `g${i}`;
        if (i / 200 >= frac) {
          h.streets[0]!.actions = [
            { actor: "SB", type: "post-sb", amount: 0.01 },
            { actor: "Hero", type: "post-bb", amount: 0.02 },
            { actor: "BTN", type: "fold" },
          ];
        }
        return h;
      };
      looseHands.push(open(0.8));
      tightHands.push(open(0.1));
    }
    const loose = modelVillainRange(handWithBtnOpen(), heroBbSpot, "BTN", {
      profile: buildProfiles(looseHands).get("BTN"),
    });
    const tight = modelVillainRange(handWithBtnOpen(), heroBbSpot, "BTN", {
      profile: buildProfiles(tightHands).get("BTN"),
    });
    expect(loose.combos.length).toBeGreaterThan(tight.combos.length);
  });

  it("polarizes a villain's range toward value after a big bet on a dry board", () => {
    const hand = handWithBtnOpen();
    hand.streets.push({
      street: "flop",
      board: [parseCard("Ah"), parseCard("7d"), parseCard("2c")],
      actions: [
        { actor: "Hero", type: "check" },
        { actor: "BTN", type: "bet", amount: 0.15 },
      ],
    });
    const flopSpot: Spot = {
      ...heroBbSpot,
      street: "flop",
      actionIndex: 2,
      board: [parseCard("Ah"), parseCard("7d"), parseCard("2c")],
    };
    const wide = modelVillainRange(hand, heroBbSpot, "BTN").combos.length;
    const narrowed = modelVillainRange(hand, flopSpot, "BTN").combos.length;
    expect(narrowed).toBeLessThan(wide);
  });
});
