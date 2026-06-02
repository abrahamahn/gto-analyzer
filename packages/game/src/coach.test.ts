import { loadDefaultCharts } from "@poker/engine";
import { parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { coachAdvice } from "./coach.js";
import { applyAction, createGame, startHand } from "./engine.js";
import type { GameConfig } from "./types.js";

loadDefaultCharts();

function cfg(seats: number): GameConfig {
  return {
    seats: Array.from({ length: seats }, (_, i) => ({ name: i === 0 ? "Hero" : `Bot${i}`, isHuman: i === 0 })),
    smallBlind: 1,
    bigBlind: 2,
    ante: 0,
    startingStack: 200,
  };
}

describe("coachAdvice", () => {
  it("gives a recommendation + factor breakdown at a heads-up flop decision", () => {
    const s = startHand(createGame(cfg(2), 7));
    // Preflop: SB calls, BB checks → flop, both have cards.
    applyAction(s, { seat: s.toAct!, type: "call" });
    applyAction(s, { seat: s.toAct!, type: "check" });
    expect(s.street).toBe("flop");

    const heroSeat = s.toAct!; // whoever acts first on the flop
    const advice = coachAdvice(s, heroSeat);

    expect(["fold", "check", "call", "bet", "raise"]).toContain(advice.recommendation.action);
    expect(advice.recommendation.reason.length).toBeGreaterThan(0);
    expect(advice.actions.length).toBeGreaterThan(0);
    const labels = advice.factors.map((f) => f.label);
    expect(labels).toContain("SPR");
    expect(labels).toContain("Position");
    expect(labels).toContain("Board");
  });

  it("surfaces pot odds and MDF when facing a bet", () => {
    const s = startHand(createGame(cfg(2), 11));
    applyAction(s, { seat: s.toAct!, type: "call" }); // SB completes
    applyAction(s, { seat: s.toAct!, type: "check" }); // BB checks → flop
    // Flop: first player bets, hero faces it.
    const bettor = s.toAct!;
    applyAction(s, { seat: bettor, type: "bet", amount: 4 });
    const heroSeat = s.toAct!;
    const advice = coachAdvice(s, heroSeat);
    const labels = advice.factors.map((f) => f.label);
    expect(labels).toContain("Pot odds");
    expect(labels).toContain("MDF");
  });
});
