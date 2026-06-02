import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { parseCoinPokerHandsStrict } from "./coinpoker.js";

const SAMPLES = join(__dirname, "../../../tools/sample-hands");

describe.skipIf(!process.env.SANITY)("sanity", () => {
  it("logs corpus stats for each fixture", () => {
    for (const filename of readdirSync(SAMPLES).filter((f) => f.endsWith(".txt"))) {
      const text = readFileSync(join(SAMPLES, filename), "utf8");
      const hands = parseCoinPokerHandsStrict(text);
      const pos: Record<string, number> = {};
      for (const h of hands.filter((x) => x.heroCards)) {
        const p = h.seats.find((s) => s.player === h.hero)?.position ?? "?";
        pos[p] = (pos[p] || 0) + 1;
      }
      const currencies = [...new Set(hands.map((h) => h.currency))];
      const h0 = hands[0]!;
      console.log(`\n--- ${filename}`);
      console.log("total hands:", hands.length);
      console.log("currencies:", currencies);
      console.log("seat sizes:", [...new Set(hands.map((h) => h.seats.length))].sort());
      console.log("hero positions:", pos);
      console.log(
        `hand 0: ${h0.handId} | ${h0.table} | ${h0.currency} ${h0.smallBlind}/${h0.bigBlind}${h0.ante ? `/ante ${h0.ante}` : ""}`,
      );
      console.log("hand 0 winners:", JSON.stringify(h0.winners));
    }
  });
});
