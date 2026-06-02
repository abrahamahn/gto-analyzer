import type { Grade, GradeAction, GradeVerdict } from "@poker/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.js";
import { PlayingCard } from "./PlayingCard.js";

const VERDICT_STYLE: Record<GradeVerdict, string> = {
  optimal: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  minor: "bg-lime-900/50 text-lime-300 border-lime-700",
  suspect: "bg-amber-900/50 text-amber-300 border-amber-700",
  blunder: "bg-red-900/60 text-red-300 border-red-700",
  unknown: "bg-neutral-800 text-neutral-400 border-neutral-700",
};

const CONFIDENCE_LABEL: Record<Grade["confidence"], string> = {
  solved: "GTO solved",
  modeled: "modeled (HU)",
  approximate: "approximate (multiway)",
};

const CONFIDENCE_STYLE: Record<Grade["confidence"], string> = {
  solved: "text-emerald-400 border-emerald-800",
  modeled: "text-sky-400 border-sky-800",
  approximate: "text-neutral-400 border-neutral-700",
};

function actionLabel(a: GradeAction): string {
  const base = a.type === "all-in" ? "all-in" : a.type.charAt(0).toUpperCase() + a.type.slice(1);
  return a.sizeBB !== undefined ? `${base} ${a.sizeBB.toFixed(1)}bb` : base;
}

function evColor(ev: number): string {
  if (ev > 0.05) return "text-emerald-300";
  if (ev < -0.05) return "text-red-300";
  return "text-neutral-300";
}

export function DecisionAnalysis({ handId, grades }: { handId: string; grades: Grade[] }) {
  if (grades.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No graded decisions (hero cards unknown or no voluntary actions).
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {grades.map((g, i) => (
        <DecisionCard
          key={`${g.decision.spot.street}-${g.decision.spot.actionIndex}-${i}`}
          handId={handId}
          index={i}
          grade={g}
        />
      ))}
    </div>
  );
}

function DecisionCard({ handId, index, grade }: { handId: string; index: number; grade: Grade }) {
  const [deep, setDeep] = useState<{ grade: Grade; iterations: number } | null>(null);
  const solve = useMutation({
    mutationFn: () => api.solveDecisionDeep(handId, index),
    onSuccess: (res) => setDeep({ grade: res.grade, iterations: res.iterations }),
  });

  const shown = deep?.grade ?? grade;
  const { spot, heroAction } = shown.decision;
  const best = Math.max(...shown.actions.map((a) => a.evBB), 0);

  return (
    <div className="rounded border border-neutral-800 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{spot.street}</span>
        <span className="flex gap-1">
          <PlayingCard card={spot.heroCards[0]} size="sm" />
          <PlayingCard card={spot.heroCards[1]} size="sm" />
        </span>
        {spot.board.length > 0 && (
          <span className="flex gap-1 ml-1">
            {spot.board.map((c, idx) => (
              <PlayingCard key={`${c.rank}${c.suit}-${idx}`} card={c} size="sm" />
            ))}
          </span>
        )}
        <span className="text-sm text-neutral-400">
          you <span className="font-medium text-neutral-200">{heroAction.type}</span>
        </span>
        <span
          className={`ml-auto rounded border px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[shown.verdict]}`}
        >
          {shown.verdict}
        </span>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${CONFIDENCE_STYLE[shown.confidence]}`}
        >
          {CONFIDENCE_LABEL[shown.confidence]}
        </span>
      </div>

      <div className="space-y-1">
        {shown.actions.map((a, idx) => (
          <ActionRow key={`${a.type}-${idx}`} action={a} isBest={a.evBB >= best - 1e-6} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="truncate">{shown.notes}</span>
        <span className="flex shrink-0 items-center gap-2">
          {shown.evLossBB > 0.001 && (
            <span className="text-amber-400">−{shown.evLossBB.toFixed(2)}bb vs best</span>
          )}
          {deep ? (
            <span className="text-emerald-500">
              deep · {formatIterations(deep.iterations)} iters
            </span>
          ) : (
            <button
              type="button"
              onClick={() => solve.mutate()}
              disabled={solve.isPending}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              {solve.isPending ? "solving…" : "Solve deeper"}
            </button>
          )}
        </span>
      </div>
      {solve.error && <p className="text-xs text-red-400">{(solve.error as Error).message}</p>}
    </div>
  );
}

function formatIterations(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function ActionRow({ action, isBest }: { action: GradeAction; isBest: boolean }) {
  const freq = action.frequency ?? 0;
  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${action.chosen ? "bg-neutral-900 ring-1 ring-emerald-700/60" : ""}`}
    >
      <span className="w-28 shrink-0 font-mono text-neutral-300">{actionLabel(action)}</span>
      <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
        <div
          className="h-full bg-sky-700"
          style={{ width: `${Math.round(freq * 100)}%` }}
          aria-label={`${Math.round(freq * 100)}% frequency`}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-xs text-neutral-400">
        {Math.round(freq * 100)}%
      </span>
      <span className={`w-24 text-right tabular-nums text-xs ${evColor(action.evBB)}`}>
        {action.evBB >= 0 ? "+" : ""}
        {action.evBB.toFixed(2)}bb
        {action.stderrBB ? (
          <span className="text-neutral-600"> ±{action.stderrBB.toFixed(2)}</span>
        ) : null}
      </span>
      <span className="w-16 text-right text-[10px] text-neutral-500">
        {action.villainFoldPct !== undefined
          ? `${Math.round(action.villainFoldPct * 100)}% fold`
          : ""}
      </span>
      {action.chosen && <span className="text-[10px] text-emerald-400">you</span>}
      {isBest && !action.chosen && <span className="text-[10px] text-sky-400">best</span>}
    </div>
  );
}
