import { loadDefaultCharts } from "@poker/engine";
import { describe, expect, it } from "vitest";
import { advanceBots, decideAction } from "./ai.js";
import { applyAction, createGame, legalActions, startHand } from "./engine.js";
import type { GameConfig } from "./types.js";

loadDefaultCharts();

function botTable(seats: number, difficulty: number): GameConfig {
  return {
    seats: Array.from({ length: seats }, (_, i) => ({
      name: `Bot${i}`,
      isHuman: false,
      difficulty,
    })),
    smallBlind: 1,
    bigBlind: 2,
    ante: 0,
    startingStack: 200,
  };
}

describe("AI", () => {
  it("decides only legal actions", () => {
    const s = startHand(createGame(botTable(6, 0.7), 3));
    const action = decideAction(s, s.toAct!);
    const legal = legalActions(s, s.toAct!).map((l) => l.type);
    expect(legal).toContain(action.type);
  });

  it("plays an all-bot hand to completion, conserving chips", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = startHand(createGame(botTable(6, 0.7), seed));
      const before = s.players.reduce((a, p) => a + p.stack, 0) + s.players.reduce((a, p) => a + p.committedThisHand, 0);
      advanceBots(s);
      expect(s.phase).toBe("complete");
      expect(s.result).not.toBeNull();
      const after = s.players.reduce((a, p) => a + p.stack, 0);
      expect(after).toBe(before); // no chips created/destroyed across the hand
      expect(Object.values(s.result!.net).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it("a high-difficulty bot solves a heads-up postflop spot into a legal action", () => {
    const s = startHand(createGame(botTable(2, 0.95), 5));
    // Reach the flop: button/SB completes, BB checks.
    applyAction(s, { seat: s.toAct!, type: "call" });
    applyAction(s, { seat: s.toAct!, type: "check" });
    expect(s.street).toBe("flop");
    const action = decideAction(s, s.toAct!); // exercises the CFR solver path
    const legal = legalActions(s, s.toAct!).map((l) => l.type);
    expect(legal).toContain(action.type);
  });

  it("a maximally loose bot (d=0) folds preflop far less than a tight one (d=1)", () => {
    let looseVPIP = 0;
    let tightVPIP = 0;
    const trials = 40;
    for (let seed = 1; seed <= trials; seed++) {
      for (const [d, bump] of [
        [0, () => looseVPIP++],
        [1, () => tightVPIP++],
      ] as const) {
        // 3-handed, UTG(=button) first to act facing just the blinds.
        const s = startHand(createGame(botTable(3, d), seed * 13));
        const a = decideAction(s, s.toAct!);
        if (a.type !== "fold") bump();
      }
    }
    expect(looseVPIP).toBeGreaterThan(tightVPIP);
  });
});
