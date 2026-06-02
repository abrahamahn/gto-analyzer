import { SpotSchema } from "@poker/shared";
import { type SolveRequest, type SolveResult, solveRequestHash, solveSpot } from "@poker/solver";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const SolveRequestSchema = z.object({
  spot: SpotSchema,
  heroRange: z.string().min(1),
  villainRange: z.string().min(1),
  tree: z
    .object({
      betSizeBB: z.number().positive().optional(),
      iterations: z.number().int().positive().max(1000000).optional(),
      seed: z.number().int().optional(),
    })
    .optional(),
  betSizings: z
    .object({
      flop: z.array(z.number().positive()).optional(),
      turn: z.array(z.number().positive()).optional(),
      river: z.array(z.number().positive()).optional(),
    })
    .optional(),
});

interface SolverCacheRow {
  result: string;
  solved_at: string;
  iterations: number;
}

export function registerSolverRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post("/solver/solve", async (req, reply) => {
    const parsed = SolveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    }

    const request = parsed.data satisfies SolveRequest;
    let hash: string;
    try {
      hash = solveRequestHash(request);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }

    const cached = db
      .prepare("SELECT result, solved_at, iterations FROM solver_cache WHERE spot_hash = ?")
      .get(hash) as SolverCacheRow | undefined;
    if (cached) {
      return {
        cached: true,
        solvedAt: cached.solved_at,
        iterations: cached.iterations,
        result: JSON.parse(cached.result) as SolveResult,
      };
    }

    try {
      const result = await solveSpot(request);
      const solvedAt = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO solver_cache (spot_hash, result, solved_at, iterations)
         VALUES (?, ?, ?, ?)`,
      ).run(result.spotHash, JSON.stringify(result), solvedAt, result.iterations);

      return { cached: false, solvedAt, iterations: result.iterations, result };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "solver failed";
}
