import type { Action, Decision, Hand } from "@poker/shared";
import { parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { loadDefaultCharts } from "./charts/data.js";
import { gradeDecision } from "./grade.js";

loadDefaultCharts();

/** A 3-handed 100bb cash hand where hero is on the button. */
function btnHand(heroCards: [string, string], heroAction: Action): Hand {
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
    heroCards: [parseCard(heroCards[0]), parseCard(heroCards[1])],
    seats: [
      { seat: 1, player: "Hero", stack: 2, position: "BTN" },
      { seat: 2, player: "SB", stack: 2, position: "SB" },
      { seat: 3, player: "BB", stack: 2, position: "BB" },
    ],
    streets: [
      {
        street: "preflop",
        board: [],
        actions: [
          { actor: "SB", type: "post-sb", amount: 0.01 },
          { actor: "BB", type: "post-bb", amount: 0.02 },
          heroAction,
        ],
      },
    ],
    potTotal: 0,
    rake: 0,
    winners: [],
  };
}

function rfiDecision(
  cards: [string, string],
  heroAction: Action,
): { hand: Hand; decision: Decision } {
  const hand = btnHand(cards, heroAction);
  const decision: Decision = {
    spot: {
      handId: "h1",
      street: "preflop",
      actionIndex: 2,
      heroPosition: "BTN",
      effectiveStackBB: 100,
      potBB: 1.5,
      toCallBB: 1,
      board: [],
      heroCards: [parseCard(cards[0]), parseCard(cards[1])],
      priorActions: [
        { actor: "SB", type: "post-sb", amount: 0.01 },
        { actor: "BB", type: "post-bb", amount: 0.02 },
      ],
    },
    heroAction,
  };
  return { hand, decision };
}

describe("gradeDecision — real EV", () => {
  it("grades opening AA on the button as optimal via the GTO chart", () => {
    const g = gradeDecision(
      rfiDecision(["As", "Ad"], { actor: "Hero", type: "raise", amount: 0.05 }),
    );
    expect(g.source).toBe("preflop-chart");
    expect(g.confidence).toBe("solved");
    expect(g.verdict).toBe("optimal");
    expect(g.evLossBB).toBeLessThan(0.1);
    // The chosen (aggressive) action is flagged and the EV table is populated.
    expect(g.actions.find((a) => a.chosen)?.type).toBe("raise");
    expect(g.actions.length).toBeGreaterThanOrEqual(3);
  });

  it("flags folding AA on the button as a blunder with real EV loss", () => {
    const g = gradeDecision(rfiDecision(["As", "Ad"], { actor: "Hero", type: "fold" }));
    expect(g.verdict).toBe("blunder");
    // Folding the best hand surrenders a clearly profitable raise.
    expect(g.evLossBB).toBeGreaterThan(1);
    expect(g.actions.find((a) => a.chosen)?.type).toBe("fold");
    expect(g.actions.find((a) => a.chosen)?.evBB).toBe(0);
  });

  it("derives action frequencies that sum to ~1", () => {
    const g = gradeDecision(
      rfiDecision(["Ks", "Qs"], { actor: "Hero", type: "raise", amount: 0.05 }),
    );
    const total = g.actions.reduce((s, a) => s + (a.frequency ?? 0), 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("prices a postflop decision by rollout, not chart", () => {
    const { hand, decision } = rfiDecision(["As", "Ad"], {
      actor: "Hero",
      type: "bet",
      amount: 0.1,
    });
    decision.spot.street = "flop";
    decision.spot.board = [parseCard("Ah"), parseCard("7d"), parseCard("2c")];
    decision.spot.toCallBB = 0;
    decision.spot.potBB = 6;
    decision.heroAction = { actor: "Hero", type: "bet", amount: 0.1 };
    const g = gradeDecision({ hand, decision });
    expect(["rollout-ev", "multiway-rollout"]).toContain(g.source);
    expect(["modeled", "approximate"]).toContain(g.confidence);
    expect(g.evLossBB).toBeGreaterThanOrEqual(0);
    // Top set on a dry board: betting should not be a blunder.
    expect(g.verdict).not.toBe("blunder");
  });
});
