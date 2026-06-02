import type { Spot } from "@poker/shared";
import { parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { expandRangeToCombos } from "../combos.js";
import { compileRange } from "../range.js";
import { rolloutSpot } from "./rollout.js";

const board = ["Ah", "Kd", "7c", "2s", "3d"].map(parseCard);

/** River spot: pot 6bb, hero to act with no bet in front, one villain. */
function riverSpot(heroCards: [string, string], toCallBB = 0): Spot {
  return {
    handId: "h1",
    street: "river",
    actionIndex: 0,
    heroPosition: "BB",
    effectiveStackBB: 50,
    potBB: 6,
    toCallBB,
    board,
    heroCards: [parseCard(heroCards[0]), parseCard(heroCards[1])],
    priorActions: [],
  };
}

function villainCombos(notation: string, dead: string[]) {
  return [expandRangeToCombos(compileRange(notation), dead.map(parseCard))];
}

describe("rolloutSpot", () => {
  it("prices fold at exactly 0 and the nuts above showdown equity", () => {
    const spot = riverSpot(["As", "Ad"]); // top set on A-K-7-2-3
    const villains = villainCombos("KQs, KJs, QQ, JJ, A8s, 76s", [
      "As",
      "Ad",
      ...board.map((c) => `${c.rank}${c.suit}`),
    ]);
    const result = rolloutSpot({
      spot,
      villains,
      candidates: [{ type: "fold" }, { type: "check" }, { type: "bet", sizeBB: 4 }],
      iterations: 8000,
    });
    const byType = Object.fromEntries(result.actions.map((a) => [a.type, a]));
    expect(byType.fold!.evBB).toBe(0);
    expect(byType.fold!.stderrBB).toBe(0);
    // Top set crushes this range — both check and bet are clearly profitable.
    expect(byType.check!.evBB).toBeGreaterThan(3);
    expect(byType.bet!.evBB).toBeGreaterThan(byType.check!.evBB);
    expect(byType.bet!.villainFoldPct).toBeGreaterThanOrEqual(0);
    expect(byType.bet!.villainFoldPct).toBeLessThanOrEqual(1);
    expect(result.confidence).toBe("modeled");
  });

  it("makes folding beat calling when hero is crushed and facing a bet", () => {
    const spot = riverSpot(["7d", "5h"], 4); // ace-high board, hero has nothing, owes 4bb
    const villains = villainCombos("AA, KK, AK, AQ, A8s", [
      "7d",
      "5h",
      ...board.map((c) => `${c.rank}${c.suit}`),
    ]);
    const result = rolloutSpot({
      spot,
      villains,
      candidates: [{ type: "fold" }, { type: "call" }],
      iterations: 8000,
    });
    const byType = Object.fromEntries(result.actions.map((a) => [a.type, a]));
    expect(byType.fold!.evBB).toBe(0);
    expect(byType.call!.evBB).toBeLessThan(0);
  });

  it("rake lowers the EV of winning lines", () => {
    const spot = riverSpot(["As", "Ad"]); // top set, wins a lot at showdown
    const villains = villainCombos("AQ, AJ, KQ, QJ, JT", ["As", "Ad", ...board.map((c) => `${c.rank}${c.suit}`)]);
    const free = rolloutSpot({ spot, villains, candidates: [{ type: "check" }], iterations: 6000, seed: 1 });
    const raked = rolloutSpot({
      spot,
      villains,
      candidates: [{ type: "check" }],
      iterations: 6000,
      seed: 1,
      rake: { percent: 0.1, capBB: 0 },
    });
    expect(raked.actions[0]!.evBB).toBeLessThan(free.actions[0]!.evBB);
    // ~10% of the pot hero collects is taken; check EV should drop by roughly that.
    expect(free.actions[0]!.evBB - raked.actions[0]!.evBB).toBeGreaterThan(0.2);
  });

  it("labels multiway spots as approximate", () => {
    const dead = ["As", "Ad", ...board.map((c) => `${c.rank}${c.suit}`)];
    const result = rolloutSpot({
      spot: riverSpot(["As", "Ad"]),
      villains: [
        expandRangeToCombos(compileRange("KQs, QQ, JJ"), dead.map(parseCard)),
        expandRangeToCombos(compileRange("A8s, 76s, 55"), dead.map(parseCard)),
      ],
      candidates: [{ type: "check" }],
      iterations: 4000,
    });
    expect(result.confidence).toBe("approximate");
  });
});
