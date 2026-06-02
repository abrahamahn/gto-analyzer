import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { getHand } from "../db/repo.js";

export function registerHandRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get<{ Params: { id: string } }>("/hands/:id", async (req, reply) => {
    const hand = getHand(db, req.params.id);
    if (!hand) return reply.code(404).send({ error: "not found" });
    return hand;
  });
}
