import { randomUUID } from "node:crypto";
import type { Hand } from "@poker/shared";
import type Database from "better-sqlite3";

export interface SessionRow {
  id: string;
  importedAt: string;
  source: "upload" | "watch";
  filename: string | null;
  handCount: number;
}

export interface HandListRow {
  id: string;
  table: string;
  playedAt: string;
  currency: string;
  smallBlind: number;
  bigBlind: number;
  hero: string;
  heroCards: string | null;
  potTotal: number;
  heroResult: number;
}

export interface IngestResult {
  sessionId: string;
  inserted: number;
  duplicates: number;
}

export function createSession(
  db: Database.Database,
  source: "upload" | "watch",
  filename: string | null,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, imported_at, source, filename, hand_count) VALUES (?, ?, ?, ?, 0)`,
  ).run(id, new Date().toISOString(), source, filename);
  return id;
}

export function deleteSession(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function ingestHands(
  db: Database.Database,
  sessionId: string,
  hands: Hand[],
): { inserted: number; duplicates: number } {
  const insertHand = db.prepare(
    `INSERT OR IGNORE INTO hands
     (id, session_id, table_name, played_at, currency, small_blind, big_blind, hero, pot_total, rake, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const bumpCount = db.prepare(`UPDATE sessions SET hand_count = ? WHERE id = ?`);

  let inserted = 0;
  let duplicates = 0;
  const tx = db.transaction((items: Hand[]) => {
    for (const h of items) {
      const r = insertHand.run(
        h.handId,
        sessionId,
        h.table,
        h.playedAt,
        h.currency,
        h.smallBlind,
        h.bigBlind,
        h.hero,
        h.potTotal,
        h.rake,
        JSON.stringify(h),
      );
      if (r.changes > 0) inserted++;
      else duplicates++;
    }
    bumpCount.run(inserted, sessionId);
  });
  tx(hands);
  return { inserted, duplicates };
}

export function listSessions(db: Database.Database): SessionRow[] {
  return db
    .prepare(
      `SELECT id, imported_at as importedAt, source, filename, hand_count as handCount
       FROM sessions
       ORDER BY imported_at DESC`,
    )
    .all() as SessionRow[];
}

export function getSession(db: Database.Database, id: string): SessionRow | undefined {
  return db
    .prepare(
      `SELECT id, imported_at as importedAt, source, filename, hand_count as handCount
       FROM sessions WHERE id = ?`,
    )
    .get(id) as SessionRow | undefined;
}

export function listHandsForSession(
  db: Database.Database,
  sessionId: string,
  limit = 1000,
): HandListRow[] {
  const rows = db
    .prepare(
      `SELECT id, table_name as "table", played_at as playedAt, currency,
              small_blind as smallBlind, big_blind as bigBlind, hero, pot_total as potTotal, payload
       FROM hands WHERE session_id = ?
       ORDER BY played_at ASC
       LIMIT ?`,
    )
    .all(sessionId, limit) as Array<HandListRow & { payload: string }>;

  return rows.map((r) => {
    const hand = JSON.parse(r.payload) as Hand;
    const heroCards = hand.heroCards
      ? `${formatHeroCard(hand.heroCards[0])}${formatHeroCard(hand.heroCards[1])}`
      : null;
    const won = hand.winners.find((w) => w.player === hand.hero)?.amount ?? 0;
    const invested = sumHeroInvested(hand);
    return {
      id: r.id,
      table: r.table,
      playedAt: r.playedAt,
      currency: r.currency,
      smallBlind: r.smallBlind,
      bigBlind: r.bigBlind,
      hero: r.hero,
      heroCards,
      potTotal: r.potTotal,
      heroResult: won - invested,
    };
  });
}

export function getHand(db: Database.Database, id: string): Hand | undefined {
  const row = db.prepare(`SELECT payload FROM hands WHERE id = ?`).get(id) as
    | { payload: string }
    | undefined;
  return row ? (JSON.parse(row.payload) as Hand) : undefined;
}

/** Every stored hand, for corpus-wide work like per-player opponent profiling. */
export function getAllHands(db: Database.Database): Hand[] {
  const rows = db.prepare("SELECT payload FROM hands").all() as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload) as Hand);
}

export function countHands(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM hands").get() as { n: number }).n;
}

export interface CachedGrade {
  grade: string;
  iterations: number;
  solvedAt: string;
}

export function getCachedDecisionGrade(
  db: Database.Database,
  cacheKey: string,
): CachedGrade | undefined {
  return db
    .prepare(
      "SELECT grade, iterations, solved_at AS solvedAt FROM decision_solve_cache WHERE cache_key = ?",
    )
    .get(cacheKey) as CachedGrade | undefined;
}

export function putCachedDecisionGrade(
  db: Database.Database,
  cacheKey: string,
  grade: string,
  iterations: number,
): void {
  db.prepare(
    "INSERT OR REPLACE INTO decision_solve_cache (cache_key, grade, iterations, solved_at) VALUES (?, ?, ?, ?)",
  ).run(cacheKey, grade, iterations, new Date().toISOString());
}

function formatHeroCard(c: { rank: string; suit: string }): string {
  return `${c.rank}${c.suit}`;
}

function sumHeroInvested(hand: Hand): number {
  let total = 0;
  for (const street of hand.streets) {
    let streetTotal = 0;
    for (const a of street.actions) {
      if (a.actor !== hand.hero) continue;
      if (a.amount === undefined) continue;
      if (a.type === "post-ante") {
        total += a.amount;
      } else if (a.type === "call") {
        streetTotal += a.amount;
      } else if (
        a.type === "post-sb" ||
        a.type === "post-bb" ||
        a.type === "bet" ||
        a.type === "raise" ||
        a.type === "all-in"
      ) {
        streetTotal = a.amount;
      }
    }
    total += streetTotal;
  }
  return total;
}
