import { readFileSync } from "node:fs";
import { buildProfiles, gradeHand, loadDefaultCharts } from "@poker/engine";
import { parseCoinPokerHands } from "@poker/parser";

loadDefaultCharts();

const file =
  process.argv[2] ?? "tools/sample-hands/CoinPoker_msl1010_2026-02-01_to_2026-05-29_Cash.txt";
const text = readFileSync(file, "utf8");
const hands = parseCoinPokerHands(text);
const profiles = buildProfiles(hands);
console.log(`parsed ${hands.length} hands, ${profiles.size} player profiles`);

let graded = 0;
for (const hand of hands.slice(0, 40)) {
  const grades = gradeHand(hand, { profiles, iterations: 6000 });
  for (const g of grades) {
    graded++;
    const s = g.decision.spot;
    const cards = s.heroCards.map((c) => `${c.rank}${c.suit}`).join("");
    const board = s.board.map((c) => `${c.rank}${c.suit}`).join(" ");
    const acts = g.actions
      .map(
        (a) =>
          `${a.type}${a.sizeBB ? `(${a.sizeBB.toFixed(1)})` : ""} ${Math.round((a.frequency ?? 0) * 100)}%/${a.evBB.toFixed(2)}bb${a.chosen ? "*" : ""}`,
      )
      .join("  ");
    console.log(
      `#${hand.handId} ${s.street.padEnd(7)} ${cards} ${board.padEnd(14)} | you ${g.decision.heroAction.type.padEnd(6)} ${g.verdict.padEnd(8)} ${g.confidence.padEnd(12)} loss ${g.evLossBB.toFixed(2)}bb | ${acts}`,
    );
  }
}
console.log(`\ngraded ${graded} decisions across 40 hands`);
