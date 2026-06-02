import type { Spot } from "@poker/shared";

export type SolverActionType = "check" | "bet" | "call" | "fold" | "raise";

export interface SolveTreeConfig {
  betSizeBB?: number;
  iterations?: number;
  seed?: number;
}

export interface SolveRequest {
  spot: Spot;
  heroRange: string;
  villainRange: string;
  tree?: SolveTreeConfig;
  betSizings?: { flop?: number[]; turn?: number[]; river?: number[] };
}

export interface SolveActionResult {
  action: SolverActionType;
  sizeBB?: number;
  frequency: number;
  evBB: number;
}

export interface SolveResult {
  spotHash: string;
  source: "river-fixed-bet-cfr";
  mode: "heads-up-river-fixed-bet";
  status: "solved";
  iterations: number;
  exploitabilityBB: number;
  actions: SolveActionResult[];
  handStrategy?: {
    combo: string;
    inHeroRange: boolean;
    actions: SolveActionResult[];
  };
  ranges: {
    heroCombos: number;
    villainCombos: number;
    legalPairs: number;
  };
  tree: {
    street: "river";
    betSizeBB: number;
    actions: ["check", "bet"];
    responseActions: ["fold", "call"];
  };
  notes: string[];
}

export interface NormalizedSolveConfig {
  betSizeBB: number;
  rawBetSizeBB: number;
  iterations: number;
  seed: number;
  betWasCapped: boolean;
}

export const DEFAULT_SOLVE_ITERATIONS = 50000;
export const MAX_SOLVE_ITERATIONS = 1000000;

export function normalizeSolveConfig(
  req: Pick<SolveRequest, "spot" | "tree" | "betSizings">,
): NormalizedSolveConfig {
  const rawBetSizeBB =
    req.tree?.betSizeBB ?? req.betSizings?.river?.[0] ?? Math.max(1, req.spot.potBB * 0.75);
  if (!Number.isFinite(rawBetSizeBB) || rawBetSizeBB <= 0) {
    throw new Error("river solver requires a positive fixed bet size");
  }

  const rawIterations = req.tree?.iterations ?? DEFAULT_SOLVE_ITERATIONS;
  if (!Number.isFinite(rawIterations) || rawIterations < 1) {
    throw new Error("river solver requires at least one CFR iteration");
  }

  const rawSeed = req.tree?.seed ?? seedFromSpot(req.spot);
  const seed = Number.isFinite(rawSeed) ? Math.trunc(rawSeed) : seedFromSpot(req.spot);
  const betSizeBB = Math.min(rawBetSizeBB, req.spot.effectiveStackBB);

  return {
    betSizeBB,
    rawBetSizeBB,
    iterations: Math.min(MAX_SOLVE_ITERATIONS, Math.trunc(rawIterations)),
    seed,
    betWasCapped: betSizeBB !== rawBetSizeBB,
  };
}

function seedFromSpot(spot: Spot): number {
  let hash = 2166136261;
  const text = JSON.stringify({
    street: spot.street,
    position: spot.heroPosition,
    stack: spot.effectiveStackBB,
    pot: spot.potBB,
    toCall: spot.toCallBB,
    board: spot.board,
    hero: spot.heroCards,
  });
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
