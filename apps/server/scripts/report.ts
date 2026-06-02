import { readFileSync, writeFileSync } from "node:fs";
import { buildProfiles, gradeHand, loadDefaultCharts } from "@poker/engine";
import { parseCoinPokerHands } from "@poker/parser";
import type { Card, Grade, GradeAction, Hand } from "@poker/shared";

loadDefaultCharts();

const file =
  process.argv[2] ?? "tools/sample-hands/CoinPoker_msl1010_2026-02-01_to_2026-05-29_Cash.txt";
const handCount = Number(process.argv[3] ?? 12);
const outPath = process.argv[4] ?? "decision-report.html";

const text = readFileSync(file, "utf8");
const hands = parseCoinPokerHands(text);
const profiles = buildProfiles(hands);
const subset = hands.slice(0, handCount);

const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" } as const;
const RED = new Set(["d", "h"]);

function card(c: Card): string {
  const red = RED.has(c.suit) ? "red" : "";
  return `<span class="card ${red}">${c.rank}${SUIT[c.suit]}</span>`;
}

const VERDICT_COLOR: Record<string, string> = {
  optimal: "#34d399",
  minor: "#a3e635",
  suspect: "#fbbf24",
  blunder: "#f87171",
  unknown: "#9ca3af",
};
const CONF_LABEL: Record<string, string> = {
  solved: "GTO solved",
  modeled: "modeled (HU)",
  approximate: "approximate (multiway)",
};

/** The recommended line: the strategy's top action, noting when it is a mix. */
function recommendation(g: Grade): string {
  if (g.actions.length === 0) return "—";
  const sorted = [...g.actions].sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));
  const top = sorted[0]!;
  const label = actionLabel(top);
  const pct = Math.round((top.frequency ?? 0) * 100);
  if (pct >= 85) return `${label} <span class="dim">(${pct}%)</span>`;
  const mix = sorted
    .filter((a) => (a.frequency ?? 0) > 0.05)
    .map((a) => `${actionLabel(a)} ${Math.round((a.frequency ?? 0) * 100)}%`)
    .join(" · ");
  return `mix → ${mix}`;
}

function actionLabel(a: GradeAction): string {
  const base = a.type === "all-in" ? "All-in" : a.type[0]!.toUpperCase() + a.type.slice(1);
  return a.sizeBB !== undefined ? `${base} ${a.sizeBB.toFixed(1)}bb` : base;
}

function actionRow(a: GradeAction, bestEv: number): string {
  const freq = Math.round((a.frequency ?? 0) * 100);
  const evCls = a.evBB > 0.05 ? "pos" : a.evBB < -0.05 ? "neg" : "";
  const isBest = a.evBB >= bestEv - 1e-6;
  const tags = [
    a.chosen ? '<span class="tag you">you</span>' : "",
    isBest && !a.chosen ? '<span class="tag best">best</span>' : "",
  ].join("");
  return `<div class="arow ${a.chosen ? "chosen" : ""}">
    <span class="aname">${actionLabel(a)}</span>
    <span class="bar"><span class="fill" style="width:${freq}%"></span></span>
    <span class="afreq">${freq}%</span>
    <span class="aev ${evCls}">${a.evBB >= 0 ? "+" : ""}${a.evBB.toFixed(2)}bb${
      a.stderrBB ? `<span class="dim"> ±${a.stderrBB.toFixed(2)}</span>` : ""
    }</span>
    <span class="atags">${tags}</span>
  </div>`;
}

function decisionCard(g: Grade): string {
  const { spot, heroAction } = g.decision;
  const bestEv = Math.max(...g.actions.map((a) => a.evBB), 0);
  const board = spot.board.map(card).join("");
  const loss =
    g.evLossBB > 0.001 ? `<span class="loss">−${g.evLossBB.toFixed(2)}bb vs best</span>` : "";
  return `<div class="decision">
    <div class="dhead">
      <span class="street">${spot.street}</span>
      <span class="cards">${spot.heroCards.map(card).join("")}</span>
      ${board ? `<span class="board">${board}</span>` : ""}
      <span class="did">you <b>${heroAction.type}</b></span>
      <span class="verdict" style="color:${VERDICT_COLOR[g.verdict]};border-color:${VERDICT_COLOR[g.verdict]}">${g.verdict}</span>
      <span class="conf">${CONF_LABEL[g.confidence] ?? g.confidence}</span>
    </div>
    <div class="rec">▶ Recommended: ${recommendation(g)}</div>
    <div class="rows">${g.actions.map((a) => actionRow(a, bestEv)).join("")}</div>
    <div class="dfoot"><span class="dim">${g.notes ?? ""}</span>${loss}</div>
  </div>`;
}

function handBlock(hand: Hand): string {
  const grades = gradeHand(hand, { profiles, iterations: 12000, solverIterations: 600 });
  if (grades.length === 0) return "";
  const hero = hand.heroCards ? hand.heroCards.map(card).join("") : "—";
  const seats = hand.seats
    .map((s) => `${s.position ?? "?"} ${s.player === hand.hero ? "<b>Hero</b>" : s.player}`)
    .join(" · ");
  return `<section class="hand">
    <h2>#${hand.handId} <span class="dim">${hero} · ${hand.bigBlind}bb game · ${seats}</span></h2>
    ${grades.map(decisionCard).join("")}
  </section>`;
}

const body = subset.map(handBlock).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>GTO Decision Report</title>
<style>
  body{background:#0a0a0a;color:#e5e5e5;font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#737373;margin-bottom:24px}
  .hand{border:1px solid #262626;border-radius:8px;padding:16px;margin-bottom:20px}
  .hand h2{font-size:14px;margin:0 0 12px;font-weight:600}
  .dim{color:#737373}
  .card{display:inline-block;border:1px solid #404040;border-radius:4px;background:#171717;padding:1px 5px;margin-right:2px;color:#e5e5e5}
  .card.red{color:#f87171}
  .decision{border:1px solid #262626;border-radius:6px;padding:10px;margin-bottom:8px}
  .dhead{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
  .street{text-transform:uppercase;font-size:11px;color:#737373;letter-spacing:.05em}
  .did{color:#a3a3a3}
  .verdict{margin-left:auto;border:1px solid;border-radius:4px;padding:1px 8px;font-weight:600;font-size:12px}
  .conf{border:1px solid #404040;border-radius:4px;padding:1px 6px;font-size:10px;text-transform:uppercase;color:#9ca3af}
  .rec{color:#38bdf8;margin:4px 0 8px;font-size:13px}
  .arow{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:4px}
  .arow.chosen{background:#171717;box-shadow:inset 0 0 0 1px rgba(16,185,129,.4)}
  .aname{width:120px;flex-shrink:0;color:#d4d4d4}
  .bar{flex:1;height:8px;background:#262626;border-radius:4px;overflow:hidden}
  .fill{display:block;height:100%;background:#0369a1}
  .afreq{width:40px;text-align:right;color:#a3a3a3;font-size:12px}
  .aev{width:110px;text-align:right;font-size:12px}
  .aev.pos{color:#34d399}.aev.neg{color:#f87171}
  .atags{width:60px;text-align:right}
  .tag{font-size:10px;padding:0 4px;border-radius:3px}
  .tag.you{color:#34d399}.tag.best{color:#38bdf8}
  .dfoot{display:flex;justify-content:space-between;margin-top:6px;font-size:11px}
  .loss{color:#fbbf24}
</style></head><body>
<h1>GTO Decision Report</h1>
<div class="sub">${subset.length} hands · ${profiles.size} opponent profiles · ${file.split("/").pop()}</div>
${body}
</body></html>`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${subset.length} hands)`);
