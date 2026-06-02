import { createHash } from "node:crypto";
import {
  type PlayerProfile,
  buildProfiles,
  extractDecisions,
  gradeDecision,
  gradeHand,
  loadDefaultCharts,
} from "@poker/engine";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import {
  countHands,
  getAllHands,
  getCachedDecisionGrade,
  getHand,
  putCachedDecisionGrade,
} from "../db/repo.js";

loadDefaultCharts();

/** Iteration budgets: cheap for the at-a-glance grade, deep for the explicit solve. */
const QUICK_ROLLOUT = 12000;
const DEEP_ROLLOUT = 150000;
const DEEP_SOLVER = 3000;

/**
 * Per-player opponent profiles, rebuilt only when the hand corpus changes. Profiles
 * are corpus-wide (the adaptive opponent model), so they sharpen as more hands import.
 */
let profileCache: { count: number; profiles: Map<string, PlayerProfile> } | null = null;

function profilesFor(db: Database.Database): {
  profiles: Map<string, PlayerProfile>;
  count: number;
} {
  const count = countHands(db);
  if (!profileCache || profileCache.count !== count) {
    profileCache = { count, profiles: buildProfiles(getAllHands(db)) };
  }
  return { profiles: profileCache.profiles, count };
}

export function registerDecisionRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get<{ Params: { id: string } }>("/hands/:id/decisions", async (req, reply) => {
    const hand = getHand(db, req.params.id);
    if (!hand) return reply.code(404).send({ error: "not found" });
    const { profiles } = profilesFor(db);
    const grades = gradeHand(hand, { profiles, iterations: QUICK_ROLLOUT });
    return { grades };
  });

  // Deep, high-precision solve of a single decision, cached by hand/decision/corpus.
  app.post<{ Params: { id: string; index: string } }>(
    "/hands/:id/decisions/:index/solve",
    async (req, reply) => {
      const hand = getHand(db, req.params.id);
      if (!hand) return reply.code(404).send({ error: "not found" });
      const index = Number(req.params.index);
      const decisions = extractDecisions(hand);
      const decision = decisions[index];
      if (!Number.isInteger(index) || !decision) {
        return reply.code(404).send({ error: "decision not found" });
      }

      const { profiles, count } = profilesFor(db);
      const cacheKey = createHash("sha256")
        .update(JSON.stringify({ id: req.params.id, index, version: count, depth: "deep" }))
        .digest("hex");

      const cached = getCachedDecisionGrade(db, cacheKey);
      if (cached) {
        return {
          cached: true,
          iterations: cached.iterations,
          solvedAt: cached.solvedAt,
          grade: JSON.parse(cached.grade),
        };
      }

      const grade = gradeDecision({
        hand,
        decision,
        profiles,
        iterations: DEEP_ROLLOUT,
        solverIterations: DEEP_SOLVER,
      });
      putCachedDecisionGrade(db, cacheKey, JSON.stringify(grade), grade.iterations ?? 0);
      return {
        cached: false,
        iterations: grade.iterations,
        solvedAt: new Date().toISOString(),
        grade,
      };
    },
  );
}
