import { createHash } from "node:crypto";
import { type Spot, formatCard } from "@poker/shared";
import { type SolveRequest, type SolveTreeConfig, normalizeSolveConfig } from "./types.js";

interface SpotHashInput {
  heroRange?: string;
  villainRange: string | string[];
  tree?: SolveTreeConfig;
  betSizings?: SolveRequest["betSizings"];
}

/**
 * Stable hash of a spot for the solver cache. Two spots that yield the same
 * solver result must hash identically. We deliberately omit handId / playedAt
 * so the cache hits across hands with the same structural situation.
 */
export function solveRequestHash(req: SolveRequest): string {
  return spotHash(req.spot, req);
}

export function spotHash(spot: Spot, input: SpotHashInput | string[]): string {
  const villainRange = Array.isArray(input) ? input : input.villainRange;
  const config = Array.isArray(input)
    ? undefined
    : normalizeSolveConfig({ spot, tree: input.tree, betSizings: input.betSizings });
  const payload = JSON.stringify({
    street: spot.street,
    pos: spot.heroPosition,
    stack: spot.effectiveStackBB.toFixed(2),
    pot: spot.potBB.toFixed(2),
    toCall: spot.toCallBB.toFixed(2),
    board: spot.board.map(formatCard).sort().join(""),
    hero: spot.heroCards.map(formatCard).sort().join(""),
    prior: spot.priorActions.map((a) => `${a.actor}:${a.type}:${a.amount ?? ""}`).join("|"),
    heroRange: Array.isArray(input) ? undefined : normalizeRange(input.heroRange),
    villain: normalizeRange(villainRange),
    tree: config
      ? {
          algorithm: "chance-sampled-cfr",
          mode: "heads-up-river-fixed-bet",
          betSizeBB: config.betSizeBB.toFixed(2),
          iterations: config.iterations,
          seed: config.seed,
        }
      : undefined,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function normalizeRange(range: string | string[] | undefined): string | string[] | undefined {
  if (range === undefined) return undefined;
  if (Array.isArray(range)) return [...range].sort();
  return range.replace(/\s+/g, " ").trim();
}
