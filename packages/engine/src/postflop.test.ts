import { type Card, type Spot, parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { expandRangeToCombos } from "./combos.js";
import { solvePostflop } from "./postflop.js";
import { compileRange } from "./range.js";

/** Hero combos exclude only the board (hero keeps its own cards). */
function heroCombos(notation: string, board: Card[]) {
  return expandRangeToCombos(compileRange(notation), board);
}

/** Villain combos exclude the board and hero's known cards. */
function villainCombos(notation: string, board: Card[], hero: [string, string]) {
  return expandRangeToCombos(compileRange(notation), [
    ...board,
    parseCard(hero[0]),
    parseCard(hero[1]),
  ]);
}

function riverSpot(board: string[], hero: [string, string], toCallBB = 0): Spot {
  return {
    handId: "h1",
    street: "river",
    actionIndex: 0,
    heroPosition: "BB",
    effectiveStackBB: 40,
    potBB: 6,
    toCallBB,
    board: board.map(parseCard),
    heroCards: [parseCard(hero[0]), parseCard(hero[1])],
    priorActions: [],
  };
}

describe("solvePostflop", () => {
  const board = ["Ah", "Kd", "7c", "2s", "3h"];

  it("produces a root strategy whose frequencies sum to ~1 with low exploitability", () => {
    const spot = riverSpot(board, ["As", "Ad"]);
    const result = solvePostflop({
      spot,
      heroCombos: heroCombos("AA, KK, QQ, JJ, AK", spot.board),
      villainCombos: villainCombos("AQ, AJ, KQ, QQ, JJ, TT", spot.board, ["As", "Ad"]),
      iterations: 1500,
    });
    expect(result.status).toBe("solved");
    expect(result.realization).toBe("exact");
    const total = result.actions.reduce((s, a) => s + a.frequency, 0);
    expect(total).toBeCloseTo(1, 2);
    // A solved 0-sum game should have small exploitability.
    expect(result.exploitabilityBB).toBeGreaterThanOrEqual(0);
    expect(result.exploitabilityBB).toBeLessThan(1.5);
  });

  it("bets a pure value range far more often than it checks", () => {
    const spot = riverSpot(board, ["As", "Ad"]); // hero holds top set
    const result = solvePostflop({
      spot,
      heroCombos: heroCombos("AA, KK, 77", spot.board), // all strong
      villainCombos: villainCombos("AQ, AJ, KQ, QJ, JT", spot.board, ["As", "Ad"]), // worse
      iterations: 1500,
    });
    const bet = result.actions
      .filter((a) => a.action === "bet")
      .reduce((s, a) => s + a.frequency, 0);
    const check = result.actions.find((a) => a.action === "check")?.frequency ?? 0;
    expect(bet).toBeGreaterThan(check);
  });

  it("returns the hero combo's per-action strategy and EV", () => {
    const spot = riverSpot(board, ["As", "Ad"]);
    const result = solvePostflop({
      spot,
      heroCombos: heroCombos("AA, KK, QQ, JJ", spot.board),
      villainCombos: villainCombos("AQ, KQ, QJ, JT", spot.board, ["As", "Ad"]),
      iterations: 1000,
    });
    expect(result.handStrategy?.inHeroRange).toBe(true);
    const freq = result.handStrategy!.actions.reduce((s, a) => s + a.frequency, 0);
    expect(freq).toBeCloseTo(1, 2);
    // Top set should never fold (it has no fold node when first to act, but if it
    // could, EV ordering must put value actions above 0).
    const betEv = result.handStrategy!.actions.find((a) => a.action === "bet")?.evBB ?? 0;
    expect(betEv).toBeGreaterThan(0);
  });

  it("solves a flop spot via equity realization", () => {
    const spot: Spot = {
      ...riverSpot(["Ah", "Kd", "7c"], ["As", "Ad"]),
      street: "flop",
      board: ["Ah", "Kd", "7c"].map(parseCard),
    };
    const result = solvePostflop({
      spot,
      heroCombos: heroCombos("AA, KK, 77, AK", spot.board),
      villainCombos: villainCombos("AQ, KQ, QJ, JT, 98s", spot.board, ["As", "Ad"]),
      iterations: 800,
      equitySamples: 200,
    });
    expect(result.realization).toBe("equity");
    expect(result.actions.reduce((s, a) => s + a.frequency, 0)).toBeCloseTo(1, 2);
    expect(result.exploitabilityBB).toBeGreaterThanOrEqual(0);
  });
});
