import type { Hand, StreetActions } from "@poker/shared";
import { parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { extractDecisions } from "./decisions.js";

/** A 3-handed 100bb cash hand (bb = 0.02) for replay-math assertions. */
function baseHand(
  streets: StreetActions[],
  heroCards: Hand["heroCards"] = [parseCard("As"), parseCard("Kd")],
): Hand {
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
    heroCards,
    seats: [
      { seat: 1, player: "SB", stack: 2, position: "SB" },
      { seat: 2, player: "Hero", stack: 2, position: "BB" },
      { seat: 3, player: "BTN", stack: 2, position: "BTN" },
    ],
    streets,
    potTotal: 0,
    rake: 0,
    winners: [],
  };
}

const PREFLOP_POSTS = [
  { actor: "SB", type: "post-sb" as const, amount: 0.01 },
  { actor: "Hero", type: "post-bb" as const, amount: 0.02 },
];

describe("extractDecisions", () => {
  it("returns nothing when hero cards are unknown", () => {
    const hand = baseHand(
      [
        {
          street: "preflop",
          board: [],
          actions: [...PREFLOP_POSTS, { actor: "BTN", type: "fold" }],
        },
      ],
      null,
    );
    expect(extractDecisions(hand)).toEqual([]);
  });

  it("does not emit decisions for forced blind posts", () => {
    const hand = baseHand([
      {
        street: "preflop",
        board: [],
        actions: [...PREFLOP_POSTS, { actor: "BTN", type: "fold" }, { actor: "SB", type: "fold" }],
      },
    ]);
    // Hero's only "action" preflop is the BB post (forced) → no voluntary decision.
    expect(extractDecisions(hand)).toEqual([]);
  });

  it("computes pot, to-call and effective stack for a BB defend vs a BTN open", () => {
    const hand = baseHand([
      {
        street: "preflop",
        board: [],
        actions: [
          ...PREFLOP_POSTS,
          { actor: "BTN", type: "raise", amount: 0.06 }, // opens to 3bb
          { actor: "SB", type: "fold" },
          { actor: "Hero", type: "call", amount: 0.04 }, // BB calls 2bb more
        ],
      },
    ]);

    const decisions = extractDecisions(hand);
    expect(decisions).toHaveLength(1);
    const { spot, heroAction } = decisions[0]!;
    expect(heroAction.type).toBe("call");
    expect(spot.street).toBe("preflop");
    // Pot before hero acts: SB 0.01 + BB 0.02 + BTN 0.06 = 0.09 → 4.5bb.
    expect(spot.potBB).toBeCloseTo(4.5, 6);
    // Hero owes 3bb − 1bb already posted = 2bb.
    expect(spot.toCallBB).toBeCloseTo(2, 6);
    // Facing a raise shows up in prior actions (used to distinguish RFI vs vs-raise).
    expect(spot.priorActions.some((a) => a.type === "raise")).toBe(true);
    // Effective stack ~99bb (hero posted 1bb of a 100bb stack).
    expect(spot.effectiveStackBB).toBeGreaterThan(95);
  });

  it("emits one decision per voluntary hero action across streets", () => {
    const hand = baseHand([
      {
        street: "preflop",
        board: [],
        actions: [
          ...PREFLOP_POSTS,
          { actor: "BTN", type: "raise", amount: 0.06 },
          { actor: "SB", type: "fold" },
          { actor: "Hero", type: "call", amount: 0.04 },
        ],
      },
      {
        street: "flop",
        board: [parseCard("2c"), parseCard("7d"), parseCard("Jh")],
        actions: [
          { actor: "Hero", type: "check" },
          { actor: "BTN", type: "bet", amount: 0.04 },
          { actor: "Hero", type: "raise", amount: 0.14 },
          { actor: "BTN", type: "fold" },
        ],
      },
    ]);

    const decisions = extractDecisions(hand);
    expect(decisions.map((d) => `${d.spot.street}:${d.heroAction.type}`)).toEqual([
      "preflop:call",
      "flop:check",
      "flop:raise",
    ]);

    const flopCheck = decisions[1]!.spot;
    expect(flopCheck.toCallBB).toBeCloseTo(0, 6);
    expect(flopCheck.board).toHaveLength(3);

    const flopRaise = decisions[2]!.spot;
    // Hero faces a 2bb bet on the flop before raising.
    expect(flopRaise.toCallBB).toBeCloseTo(2, 6);
  });

  it("skips hero actions once hero is already all-in", () => {
    const hand = baseHand([
      {
        street: "preflop",
        board: [],
        actions: [
          ...PREFLOP_POSTS,
          { actor: "BTN", type: "raise", amount: 0.06 },
          { actor: "SB", type: "fold" },
          { actor: "Hero", type: "all-in" }, // commits remaining 1.98
          { actor: "BTN", type: "call", amount: 1.94 },
        ],
      },
    ]);

    const decisions = extractDecisions(hand);
    // Only the all-in shove is a decision; hero has no chips left afterward.
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.heroAction.type).toBe("all-in");
  });
});
