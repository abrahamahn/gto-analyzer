import { loadDefaultCharts } from "@poker/engine";
import { formatCard } from "@poker/shared";
import { coachAdvice } from "../src/coach.js";
import { applyAction, createGame, legalActions, startHand } from "../src/engine.js";
import type { GameConfig } from "../src/types.js";

loadDefaultCharts();

const config: GameConfig = {
  seats: [
    { name: "You", isHuman: true },
    { name: "Villain", isHuman: false, difficulty: 0.8 },
  ],
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  startingStack: 200,
};

const s = startHand(createGame(config, 42));
// Preflop: SB(=button) raises to 6, BB calls → flop.
applyAction(s, { seat: s.toAct!, type: "raise", amount: 6 });
applyAction(s, { seat: s.toAct!, type: "call" });
// Flop: OOP player bets 6, hero faces it.
const bettor = s.toAct!;
applyAction(s, { seat: bettor, type: "bet", amount: 6 });

const heroSeat = s.toAct!;
const hero = s.players[heroSeat]!;
console.log(`\nBoard: ${s.board.map(formatCard).join(" ")}`);
console.log(`Your hand: ${hero.holeCards!.map(formatCard).join(" ")}`);
console.log(`Pot ${s.players.reduce((a, p) => a + p.committedThisHand, 0)} | to call ${s.currentBet - hero.committedThisStreet} | your stack ${hero.stack}`);
console.log(`Legal: ${legalActions(s, heroSeat).map((a) => a.type + (a.min ? `(${a.min}-${a.max})` : "")).join(", ")}`);

const advice = coachAdvice(s, heroSeat);
console.log(`\n▶ COACH: ${advice.recommendation.reason}  [${advice.confidence}]`);
console.log("\nOptions (EV):");
for (const a of advice.actions) {
  console.log(`  ${a.type}${a.sizeBB ? ` ${a.sizeBB.toFixed(1)}bb` : ""}  ${Math.round((a.frequency ?? 0) * 100)}%  ${a.evBB >= 0 ? "+" : ""}${a.evBB.toFixed(2)}bb`);
}
console.log("\nFull factor breakdown:");
for (const f of advice.factors) {
  console.log(`  • ${f.label}: ${f.value}\n      ${f.detail}`);
}
