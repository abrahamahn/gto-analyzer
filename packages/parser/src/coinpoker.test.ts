import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HandSchema } from "@poker/shared";
import { describe, expect, it } from "vitest";
import { ParserError, parseCoinPokerHands, parseCoinPokerHandsStrict } from "./coinpoker.js";

const SAMPLES_DIR = join(__dirname, "../../../tools/sample-hands");

function listSampleFiles(): string[] {
  try {
    return readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".txt"));
  } catch {
    return [];
  }
}

describe("parseCoinPokerHands", () => {
  it("returns [] for empty input", () => {
    expect(parseCoinPokerHands("")).toEqual([]);
  });

  it("throws a ParserError on malformed input", () => {
    expect(() => parseCoinPokerHandsStrict("CoinPoker Hand #123\nnope\n")).toThrow(ParserError);
  });
});

describe.each(listSampleFiles())("fixture: %s", (filename) => {
  const text = readFileSync(join(SAMPLES_DIR, filename), "utf8");

  it("parses every hand strictly with no errors", () => {
    const hands = parseCoinPokerHandsStrict(text);
    expect(hands.length).toBeGreaterThan(0);
  });

  it("every parsed hand passes HandSchema validation", () => {
    const hands = parseCoinPokerHandsStrict(text);
    for (const hand of hands) {
      const result = HandSchema.safeParse(hand);
      if (!result.success) {
        throw new Error(
          `hand ${hand.handId} failed validation:\n${JSON.stringify(result.error.format(), null, 2)}\nhand: ${JSON.stringify(hand, null, 2).slice(0, 500)}`,
        );
      }
    }
  });

  it("every hand has preflop SB and BB posts", () => {
    const hands = parseCoinPokerHandsStrict(text);
    for (const hand of hands) {
      const preflop = hand.streets.find((s) => s.street === "preflop");
      expect(preflop, `hand ${hand.handId} missing preflop`).toBeDefined();
      const sb = preflop!.actions.find((a) => a.type === "post-sb");
      const bb = preflop!.actions.find((a) => a.type === "post-bb");
      expect(sb, `hand ${hand.handId} missing SB post`).toBeDefined();
      expect(bb, `hand ${hand.handId} missing BB post`).toBeDefined();
    }
  });

  it("ante posts come before SB/BB posts", () => {
    const hands = parseCoinPokerHandsStrict(text);
    for (const hand of hands) {
      const preflop = hand.streets.find((s) => s.street === "preflop")!;
      const firstSbIdx = preflop.actions.findIndex((a) => a.type === "post-sb");
      const lastAnteIdx = preflop.actions
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.type === "post-ante")
        .pop()?.i;
      if (lastAnteIdx !== undefined) {
        expect(lastAnteIdx, `hand ${hand.handId} has antes after SB`).toBeLessThan(firstSbIdx);
      }
    }
  });

  it("hero hand records hero cards when shown", () => {
    const hands = parseCoinPokerHandsStrict(text);
    const heroHands = hands.filter((h) => h.heroCards !== null);
    expect(heroHands.length).toBeGreaterThan(0);
  });

  it("pot totals are positive when there are winners", () => {
    const hands = parseCoinPokerHandsStrict(text);
    for (const hand of hands) {
      if (hand.winners.length > 0) {
        expect(hand.potTotal, `hand ${hand.handId} has winners but pot=0`).toBeGreaterThan(0);
      }
    }
  });
});
