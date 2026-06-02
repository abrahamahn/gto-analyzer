import { randomUUID } from "node:crypto";
import { gradeHand, loadDefaultCharts } from "@poker/engine";
import {
  type GameConfig,
  type GameState,
  advanceBots,
  applyAction,
  coachAdvice,
  createGame,
  rakeOf,
  startHand,
  toHand,
  viewFor,
} from "@poker/game";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

loadDefaultCharts();

const CreateSchema = z.object({
  seats: z.number().int().min(2).max(9).default(6),
  difficulty: z.number().min(0).max(1).default(0.7),
  smallBlind: z.number().positive().default(1),
  bigBlind: z.number().positive().default(2),
  ante: z.number().nonnegative().default(0),
  startingStack: z.number().positive().default(200),
  rakePercent: z.number().min(0).max(0.1).default(0),
  rakeCap: z.number().nonnegative().default(0),
  humanName: z.string().default("You"),
});

const ActionSchema = z.object({
  type: z.enum(["fold", "check", "call", "bet", "raise"]),
  amount: z.number().optional(),
});

function loadState(db: Database.Database, id: string): GameState | undefined {
  const row = db.prepare("SELECT state FROM games WHERE id = ?").get(id) as
    | { state: string }
    | undefined;
  return row ? (JSON.parse(row.state) as GameState) : undefined;
}

function saveState(db: Database.Database, id: string, state: GameState): void {
  db.prepare("INSERT OR REPLACE INTO games (id, state, updated_at) VALUES (?, ?, ?)").run(
    id,
    JSON.stringify(state),
    new Date().toISOString(),
  );
}

const humanSeatOf = (state: GameState) => state.players.findIndex((p) => p.isHuman);

export function registerGameRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post("/game", async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    }
    const o = parsed.data;
    const config: GameConfig = {
      seats: Array.from({ length: o.seats }, (_, i) => ({
        name: i === 0 ? o.humanName : `Bot ${i}`,
        isHuman: i === 0,
        difficulty: o.difficulty,
      })),
      smallBlind: o.smallBlind,
      bigBlind: o.bigBlind,
      ante: o.ante,
      startingStack: o.startingStack,
      rakePercent: o.rakePercent,
      rakeCap: o.rakeCap,
    };
    const state = startHand(createGame(config, Date.now() >>> 0));
    advanceBots(state);
    const id = randomUUID();
    saveState(db, id, state);
    return { id, view: viewFor(state, humanSeatOf(state)) };
  });

  app.get<{ Params: { id: string } }>("/game/:id", async (req, reply) => {
    const state = loadState(db, req.params.id);
    if (!state) return reply.code(404).send({ error: "game not found" });
    return { view: viewFor(state, humanSeatOf(state)) };
  });

  app.post<{ Params: { id: string } }>("/game/:id/action", async (req, reply) => {
    const state = loadState(db, req.params.id);
    if (!state) return reply.code(404).send({ error: "game not found" });
    const seat = humanSeatOf(state);
    if (state.toAct !== seat) return reply.code(400).send({ error: "not your turn" });
    const parsed = ActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad action" });
    try {
      applyAction(state, { seat, type: parsed.data.type, amount: parsed.data.amount });
      advanceBots(state);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "illegal action" });
    }
    saveState(db, req.params.id, state);
    return { view: viewFor(state, seat) };
  });

  app.post<{ Params: { id: string } }>("/game/:id/next", async (req, reply) => {
    const state = loadState(db, req.params.id);
    if (!state) return reply.code(404).send({ error: "game not found" });
    startHand(state);
    advanceBots(state);
    saveState(db, req.params.id, state);
    return { view: viewFor(state, humanSeatOf(state)) };
  });

  app.get<{ Params: { id: string } }>("/game/:id/hint", async (req, reply) => {
    const state = loadState(db, req.params.id);
    if (!state) return reply.code(404).send({ error: "game not found" });
    const seat = humanSeatOf(state);
    if (state.toAct !== seat || state.phase === "complete") {
      return reply.code(400).send({ error: "no decision to coach right now" });
    }
    return { advice: coachAdvice(state, seat) };
  });

  app.get<{ Params: { id: string } }>("/game/:id/review", async (req, reply) => {
    const state = loadState(db, req.params.id);
    if (!state) return reply.code(404).send({ error: "game not found" });
    if (state.phase !== "complete") return reply.code(400).send({ error: "hand not finished" });
    const seat = humanSeatOf(state);
    const grades = gradeHand(toHand(state, seat), { rake: rakeOf(state.config) });
    return { grades };
  });
}
