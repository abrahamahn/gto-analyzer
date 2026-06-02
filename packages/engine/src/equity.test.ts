import { type Card, parseCard } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { equityVsRange, equityVsRanges, evaluate7 } from "./equity.js";
import { rankValue } from "./handClass.js";

const enc = (s: string) => {
  const c = parseCard(s);
  return { rank: rankValue(c.rank), suit: { c: 0, d: 1, h: 2, s: 3 }[c.suit]! };
};
const hand = (...cards: string[]) => cards.map(enc);
const pair = (a: string, b: string): [Card, Card] => [parseCard(a), parseCard(b)];

describe("evaluate7", () => {
  it("ranks a royal flush above quads", () => {
    const royal = hand("As", "Ks", "Qs", "Js", "Ts", "2c", "3d");
    const quads = hand("Ac", "Ad", "Ah", "As", "Kc", "Kd", "2s");
    expect(evaluate7(royal)).toBeGreaterThan(evaluate7(quads));
  });

  it("ranks a full house above a flush", () => {
    const boat = hand("As", "Ad", "Ah", "Ks", "Kd", "2c", "3d");
    const flush = hand("As", "Ks", "9s", "5s", "2s", "Kd", "3d");
    expect(evaluate7(boat)).toBeGreaterThan(evaluate7(flush));
  });

  it("recognises the wheel straight (A-2-3-4-5)", () => {
    const wheel = hand("As", "2d", "3c", "4h", "5s", "Kd", "Qc");
    const noStraight = hand("As", "Kd", "Qc", "9h", "7s", "4d", "2c");
    expect(evaluate7(wheel)).toBeGreaterThan(evaluate7(noStraight));
  });

  it("breaks ties by kicker", () => {
    const aceKing = hand("As", "Ad", "Ks", "9d", "7c", "3h", "2s");
    const aceQueen = hand("As", "Ad", "Qs", "9d", "7c", "3h", "2s");
    expect(evaluate7(aceKing)).toBeGreaterThan(evaluate7(aceQueen));
  });
});

describe("equityVsRange", () => {
  it("makes AA a heavy favourite over a random opponent", () => {
    const result = equityVsRange({
      hero: pair("As", "Ad"),
      villainRange: [pair("Kc", "Kh"), pair("Qc", "Qh"), pair("Jc", "Jh")],
      board: [],
      iterations: 4000,
    });
    expect(result.equity).toBeGreaterThan(0.78);
  });

  it("is roughly a coin flip for a pair vs two overcards (race)", () => {
    const result = equityVsRange({
      hero: pair("8s", "8d"),
      villainRange: [pair("Ac", "Kh")],
      board: [],
      iterations: 6000,
    });
    expect(result.equity).toBeGreaterThan(0.46);
    expect(result.equity).toBeLessThan(0.58);
  });

  it("returns equity = win + tie/2", () => {
    const r = equityVsRange({
      hero: pair("As", "Ks"),
      villainRange: [pair("Qd", "Qc")],
      board: [],
      iterations: 2000,
    });
    expect(r.equity).toBeCloseTo(r.win + r.tie / 2, 9);
  });

  it("splits equity correctly in a three-way tie", () => {
    const r = equityVsRanges({
      hero: pair("Ah", "Kd"),
      villainRanges: [[pair("Ac", "Qd")], [pair("As", "Jd")]],
      board: ["2c", "2d", "5h", "5s", "9c"].map(parseCard),
      iterations: 200,
    });
    expect(r.win).toBe(0);
    expect(r.tie).toBe(1);
    expect(r.lose).toBe(0);
    expect(r.equity).toBeCloseTo(1 / 3, 9);
  });
});
