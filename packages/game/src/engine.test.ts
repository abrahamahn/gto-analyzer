import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalActions, startHand } from "./engine.js";
import { buildPots } from "./showdown.js";
import type { GameConfig, GameState, PlayerState } from "./types.js";

function cfg(seats: number, startingStack = 200): GameConfig {
  return {
    seats: Array.from({ length: seats }, (_, i) => ({
      name: i === 0 ? "Hero" : `Bot${i}`,
      isHuman: i === 0,
    })),
    smallBlind: 1,
    bigBlind: 2,
    ante: 0,
    startingStack,
  };
}

const seat = (s: GameState, i: number): PlayerState => s.players[i]!;
const potOf = (s: GameState) => s.players.reduce((sum, p) => sum + p.committedThisHand, 0);

describe("NLHE engine", () => {
  it("posts blinds and sets the first actor heads-up (button acts first preflop)", () => {
    const s = startHand(createGame(cfg(2), 1));
    expect(seat(s, s.buttonSeat).committedThisStreet).toBe(1); // button is SB
    const bb = s.players.find((p) => p.committedThisStreet === 2)!;
    expect(bb.seat).not.toBe(s.buttonSeat);
    expect(s.toAct).toBe(s.buttonSeat); // SB/button acts first HU
    expect(s.currentBet).toBe(2);
  });

  it("enforces a legal min-raise size", () => {
    const s = startHand(createGame(cfg(3), 2));
    const utg = s.toAct!;
    const raise = legalActions(s, utg).find((l) => l.type === "raise")!;
    expect(raise.min).toBe(4); // currentBet 2 + minRaise 2
    // A raise to 3 is illegal (below min).
    expect(() => applyAction(s, { seat: utg, type: "raise", amount: 3 })).toThrow();
  });

  it("plays a folded-around hand and awards the pot uncontested with no showdown", () => {
    const s = startHand(createGame(cfg(3), 3));
    // 3-handed: UTG(=button) folds, SB folds → BB wins (only 2 folds needed).
    applyAction(s, { seat: s.toAct!, type: "fold" });
    applyAction(s, { seat: s.toAct!, type: "fold" });
    expect(s.phase).toBe("complete");
    expect(s.result?.shown).toEqual([]);
    expect(s.result?.pots[0]?.winners.length).toBe(1);
    const winnerSeat = s.result!.pots[0]!.winners[0]!;
    expect(s.result!.net[winnerSeat]).toBe(1); // BB won sb1+bb2=3, posted bb2 → +1
  });

  it("runs a full hand to showdown and conserves chips", () => {
    const s = startHand(createGame(cfg(2), 5));
    const before = s.players.reduce((sum, p) => sum + p.stack, 0) + potOf(s);
    // Preflop: SB calls, BB checks.
    applyAction(s, { seat: s.toAct!, type: "call" });
    applyAction(s, { seat: s.toAct!, type: "check" });
    // Flop/turn/river: both check down.
    for (let street = 0; street < 3; street++) {
      applyAction(s, { seat: s.toAct!, type: "check" });
      applyAction(s, { seat: s.toAct!, type: "check" });
    }
    expect(s.phase).toBe("complete");
    expect(s.board.length).toBe(5);
    const after = s.players.reduce((sum, p) => sum + p.stack, 0);
    expect(after).toBe(before); // no chips created or destroyed
    expect(Object.values(s.result!.net).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("builds main and side pots for unequal all-ins", () => {
    // Three players commit 50 / 100 / 100 → main pot 150, side pot 100.
    const players = [
      { seat: 0, committedThisHand: 50, status: "all-in" },
      { seat: 1, committedThisHand: 100, status: "active" },
      { seat: 2, committedThisHand: 100, status: "folded" },
    ] as PlayerState[];
    const pots = buildPots(players);
    expect(pots[0]!.amount).toBe(150); // 50 * 3
    expect(pots[0]!.eligible.sort()).toEqual([0, 1]); // seat 2 folded
    expect(pots[1]!.amount).toBe(100); // 50 * 2 (seats 1 & 2)
    expect(pots[1]!.eligible).toEqual([1]); // only seat 1 not folded above 50
  });

  it("takes rake from a pot that saw a flop, and none preflop", () => {
    // Rake 10%, uncapped. Both players see a flop and check down.
    const config = { ...cfg(2, 5), rakePercent: 0.1, rakeCap: 0 };
    const s = startHand(createGame(config, 9));
    applyAction(s, { seat: s.toAct!, type: "call" }); // SB completes → pot 4
    applyAction(s, { seat: s.toAct!, type: "check" }); // BB checks → flop
    for (let street = 0; street < 3; street++) {
      applyAction(s, { seat: s.toAct!, type: "check" });
      applyAction(s, { seat: s.toAct!, type: "check" });
    }
    expect(s.result!.rake).toBe(Math.floor(0.1 * 4)); // pot 4 → rake 0 (floor) ... ensure logic runs
    // With a 4-chip pot, 10% floors to 0; bump blinds to verify a non-zero rake.
    const big = { ...cfg(2, 50), smallBlind: 5, bigBlind: 10, rakePercent: 0.1, rakeCap: 0 };
    const s2 = startHand(createGame(big, 9));
    applyAction(s2, { seat: s2.toAct!, type: "call" }); // pot 20
    applyAction(s2, { seat: s2.toAct!, type: "check" });
    for (let street = 0; street < 3; street++) {
      applyAction(s2, { seat: s2.toAct!, type: "check" });
      applyAction(s2, { seat: s2.toAct!, type: "check" });
    }
    expect(s2.result!.rake).toBe(2); // 10% of 20
    const totalStacks = s2.players.reduce((a, p) => a + p.stack, 0);
    expect(totalStacks).toBe(2 * 50 - 2); // rake left the table
  });

  it("does not rake a pot that folded preflop (no flop, no drop)", () => {
    const config = { ...cfg(3, 50), smallBlind: 5, bigBlind: 10, rakePercent: 0.1 };
    const s = startHand(createGame(config, 4));
    applyAction(s, { seat: s.toAct!, type: "fold" });
    applyAction(s, { seat: s.toAct!, type: "fold" });
    expect(s.result!.rake).toBe(0);
  });

  it("an all-in under-raise does not reopen raising for players who already acted", () => {
    // 3-handed (button=0, SB=1, BB=2, UTG=button=0).
    const s = startHand(createGame(cfg(3), 1));
    applyAction(s, { seat: 0, type: "raise", amount: 6 }); // UTG full raise to 6 (min was 4)
    applyAction(s, { seat: 1, type: "call" }); // SB calls 6 → has acted since the full raise
    seat(s, 2).stack = 5; // BB has 2 in + 5 behind → can only reach 7 (an under-raise)
    applyAction(s, { seat: 2, type: "raise", amount: 7 }); // all-in under-raise (+1 < minRaise 4)
    // Action back to SB (seat 1), who already called the full raise: call/fold only, no re-raise.
    expect(s.toAct).toBe(0);
    const acts = legalActions(s, 0).map((a) => a.type);
    expect(acts).toContain("call");
    expect(acts).not.toContain("raise");
  });
});
