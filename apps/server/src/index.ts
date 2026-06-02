import { join } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { openDb } from "./db/db.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerGameRoutes } from "./routes/game.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerSolverRoutes } from "./routes/solver.js";

const PORT = Number(process.env.PORT ?? 4477);
const DB_PATH = process.env.POKER_DB_PATH ?? join(process.cwd(), "data", "poker.sqlite");

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

const db = openDb(DB_PATH);

app.get("/health", () => ({
  ok: true,
  service: "poker-server",
  dbPath: DB_PATH,
  handCount: (db.prepare("SELECT COUNT(*) AS n FROM hands").get() as { n: number }).n,
}));

registerSessionRoutes(app, db);
registerHandRoutes(app, db);
registerDecisionRoutes(app, db);
registerGameRoutes(app, db);
registerSolverRoutes(app, db);

try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  app.log.info(`poker-server listening on http://127.0.0.1:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
