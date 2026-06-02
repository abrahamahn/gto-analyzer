import { type Spot, parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { solveRequestHash } from "./hash.js";
import { solveSpot } from "./solve.js";
import type { SolveRequest } from "./types.js";

describe("solveSpot", () => {
  it("solves a scoped heads-up river fixed-bet node", async () => {
    const result = await solveSpot(makeRequest());

    expect(result.source).toBe("river-fixed-bet-cfr");
    expect(result.mode).toBe("heads-up-river-fixed-bet");
    expect(result.iterations).toBe(3000);
    expect(result.ranges.legalPairs).toBeGreaterThan(0);
    expect(result.exploitabilityBB).toBeGreaterThanOrEqual(0);
    expect(result.actions.map((action) => action.action)).toEqual(["check", "bet"]);

    const frequency = result.actions.reduce((sum, action) => sum + action.frequency, 0);
    expect(frequency).toBeGreaterThan(0.99);
    expect(frequency).toBeLessThan(1.01);
    for (const action of result.actions) {
      expect(Number.isFinite(action.evBB)).toBe(true);
      expect(action.frequency).toBeGreaterThanOrEqual(0);
      expect(action.frequency).toBeLessThanOrEqual(1);
    }

    expect(result.handStrategy?.combo).toBe("AsKs");
    expect(result.handStrategy?.inHeroRange).toBe(true);
  });

  it("hashes tree-relevant strategy inputs", () => {
    const req = makeRequest();
    const largerBet = makeRequest({ tree: { betSizeBB: 8, iterations: 3000, seed: 7 } });
    const widerHeroRange = makeRequest({ heroRange: "AKs, AQs, KQs" });

    expect(solveRequestHash(req)).not.toBe(solveRequestHash(largerBet));
    expect(solveRequestHash(req)).not.toBe(solveRequestHash(widerHeroRange));
  });

  it("rejects unsupported non-river spots", async () => {
    await expect(
      solveSpot(
        makeRequest({
          spot: { ...baseSpot(), street: "turn", board: cards(["Qh", "Td", "2c", "7s"]) },
        }),
      ),
    ).rejects.toThrow(/river spots only/);
  });
});

function makeRequest(overrides: Partial<SolveRequest> = {}): SolveRequest {
  return {
    spot: baseSpot(),
    heroRange: "AKs, AQs",
    villainRange: "QQ, TT, KJs, AJo",
    tree: { betSizeBB: 6, iterations: 3000, seed: 7 },
    ...overrides,
  };
}

function baseSpot(): Spot {
  return {
    handId: "test-river",
    street: "river",
    actionIndex: 0,
    heroPosition: "BTN",
    effectiveStackBB: 100,
    potBB: 12,
    toCallBB: 0,
    board: cards(["Qh", "Td", "2c", "7s", "3d"]),
    heroCards: [parseCard("As"), parseCard("Ks")],
    priorActions: [],
  };
}

function cards(text: string[]) {
  return text.map(parseCard);
}
