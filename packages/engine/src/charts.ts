import type { ActionType, Position } from "@poker/shared";
import { handClass } from "./handClass.js";
import { compileRange, type RangeWeights } from "./range.js";

export type GameFormat = "cash" | "mtt";

/** One action a chart can take, with the range (notation) that takes it at what frequency. */
export interface ChartActionDef {
  type: ActionType;
  sizeBB?: number;
  range: string;
}

/**
 * A GTO preflop strategy for one (format, stack, position, scenario). Fold is the
 * implicit remainder of frequency not assigned to an explicit action, so charts
 * only declare the aggressive/calling parts.
 */
export interface PreflopChart {
  id: string;
  format: GameFormat;
  stackBB: number;
  position: Position;
  /** Short human label, e.g. "RFI" or "BB vs BTN open". */
  scenario: string;
  vsPosition?: Position;
  description?: string;
  actions: ChartActionDef[];
}

/** Resolved frequency for a single action of a hand class. */
export interface ChartAction {
  type: ActionType;
  frequency: number;
  sizeBB?: number;
}

interface CompiledAction extends ChartActionDef {
  weights: RangeWeights;
}

interface CompiledChart extends PreflopChart {
  compiled: CompiledAction[];
}

const charts = new Map<string, CompiledChart>();

export function loadChart(chart: PreflopChart): void {
  charts.set(chart.id, {
    ...chart,
    compiled: chart.actions.map((a) => ({ ...a, weights: compileRange(a.range) })),
  });
}

export function getChartById(id: string): PreflopChart | undefined {
  return charts.get(id);
}

export function listCharts(): PreflopChart[] {
  return [...charts.values()];
}

export interface ChartQuery {
  format: GameFormat;
  stackBB: number;
  position: Position;
  scenario: string;
  vsPosition?: Position;
}

export function findChart(q: ChartQuery): PreflopChart | undefined {
  return [...charts.values()].find(
    (c) =>
      c.format === q.format &&
      c.stackBB === q.stackBB &&
      c.position === q.position &&
      c.scenario === q.scenario &&
      (q.vsPosition === undefined || c.vsPosition === q.vsPosition),
  );
}

/**
 * Resolve a single hand class to its action mix in a chart. Returns every
 * declared action plus an explicit "fold" remainder, dropping zero-weight
 * actions. Frequencies always sum to 1.
 */
export function evaluateHand(chart: PreflopChart, cls: string): ChartAction[] {
  const compiled = charts.get(chart.id)?.compiled ?? chart.actions.map((a) => ({ ...a, weights: compileRange(a.range) }));
  const actions: ChartAction[] = [];
  let assigned = 0;
  for (const a of compiled) {
    const freq = a.weights[cls] ?? 0;
    if (freq <= 0) continue;
    assigned += freq;
    actions.push(a.sizeBB === undefined ? { type: a.type, frequency: freq } : { type: a.type, frequency: freq, sizeBB: a.sizeBB });
  }
  const fold = Math.max(0, 1 - assigned);
  if (fold > 1e-9) actions.push({ type: "fold", frequency: fold });
  return actions;
}

/** Full chart resolved to all 169 classes → action mix, for grid rendering. */
export function evaluateChart(chart: PreflopChart): Record<string, ChartAction[]> {
  const out: Record<string, ChartAction[]> = {};
  const compiled = charts.get(chart.id)?.compiled ?? chart.actions.map((a) => ({ ...a, weights: compileRange(a.range) }));
  const allClasses = new Set<string>();
  for (const a of compiled) for (const cls of Object.keys(a.weights)) allClasses.add(cls);
  for (const cls of allClasses) out[cls] = evaluateHand(chart, cls);
  return out;
}

/** Strategy for two specific hole cards in a chart. */
export function strategyFor(chart: PreflopChart, a: Parameters<typeof handClass>[0], b: Parameters<typeof handClass>[1]): ChartAction[] {
  return evaluateHand(chart, handClass(a, b));
}
