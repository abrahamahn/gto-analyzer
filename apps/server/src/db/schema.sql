-- Single-user local SQLite schema. Run on first boot if not present.

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  source      TEXT NOT NULL,            -- 'upload' | 'watch'
  filename    TEXT,
  hand_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hands (
  id          TEXT PRIMARY KEY,         -- CoinPoker hand id
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  played_at   TEXT NOT NULL,
  currency    TEXT NOT NULL,
  small_blind REAL NOT NULL,
  big_blind   REAL NOT NULL,
  hero        TEXT NOT NULL,
  pot_total   REAL NOT NULL,
  rake        REAL NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL              -- full JSON Hand for fast read
);
CREATE INDEX IF NOT EXISTS hands_session_idx ON hands(session_id);
CREATE INDEX IF NOT EXISTS hands_played_at_idx ON hands(played_at);

CREATE TABLE IF NOT EXISTS decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id       TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  street        TEXT NOT NULL,
  action_index  INTEGER NOT NULL,
  hero_position TEXT NOT NULL,
  payload       TEXT NOT NULL             -- full JSON Decision
);
CREATE INDEX IF NOT EXISTS decisions_hand_idx ON decisions(hand_id);

CREATE TABLE IF NOT EXISTS grades (
  decision_id  INTEGER PRIMARY KEY REFERENCES decisions(id) ON DELETE CASCADE,
  verdict      TEXT NOT NULL,
  ev_loss_bb   REAL NOT NULL,
  source       TEXT NOT NULL,
  notes        TEXT,
  graded_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS grades_verdict_idx ON grades(verdict);

CREATE TABLE IF NOT EXISTS solver_cache (
  spot_hash   TEXT PRIMARY KEY,
  result      TEXT NOT NULL,             -- full JSON SolveResult
  solved_at   TEXT NOT NULL,
  iterations  INTEGER NOT NULL
);

-- High-precision on-demand decision grades, keyed by hand/decision/corpus version.
CREATE TABLE IF NOT EXISTS decision_solve_cache (
  cache_key   TEXT PRIMARY KEY,
  grade       TEXT NOT NULL,             -- full JSON Grade
  iterations  INTEGER NOT NULL,
  solved_at   TEXT NOT NULL
);

-- Live play-vs-AI game sessions (server-authoritative full GameState JSON).
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  state       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
