import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { parseCoinPokerHands, ParserError } from "@poker/parser";
import {
  createSession,
  deleteSession,
  getSession,
  ingestHands,
  listHandsForSession,
  listSessions,
} from "../db/repo.js";

export function registerSessionRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post("/sessions", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no file uploaded" });
    if (file.mimetype !== "text/plain" && !file.filename.endsWith(".txt")) {
      return reply.code(400).send({ error: `expected .txt file, got ${file.filename}` });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString("utf8");

    let hands;
    try {
      hands = parseCoinPokerHands(text);
    } catch (err) {
      const message = err instanceof ParserError ? err.message : "parser failed";
      return reply.code(400).send({ error: message });
    }

    if (hands.length === 0) {
      return reply.code(400).send({ error: "no supported hands found in file" });
    }

    const sessionId = createSession(db, "upload", file.filename);
    const { inserted, duplicates } = ingestHands(db, sessionId, hands);
    if (inserted === 0) deleteSession(db, sessionId);

    return {
      sessionId: inserted === 0 ? null : sessionId,
      totalParsed: hands.length,
      inserted,
      duplicates,
    };
  });

  app.get("/sessions", async () => {
    return { sessions: listSessions(db) };
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const session = getSession(db, req.params.id);
    if (!session) return reply.code(404).send({ error: "not found" });
    return session;
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/hands", async (req, reply) => {
    const session = getSession(db, req.params.id);
    if (!session) return reply.code(404).send({ error: "not found" });
    return { hands: listHandsForSession(db, req.params.id) };
  });
}
