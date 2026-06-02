import type { CoachAdvice, GameView } from "@poker/game";
import type { Grade, Hand, Spot } from "@poker/shared";

export interface CreateGameBody {
  seats: number;
  difficulty: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  startingStack?: number;
  rakePercent?: number;
  rakeCap?: number;
}

export interface GameActionBody {
  type: "fold" | "check" | "call" | "bet" | "raise";
  amount?: number;
}

export interface Session {
  id: string;
  importedAt: string;
  source: "upload" | "watch";
  filename: string | null;
  handCount: number;
}

export interface HandListItem {
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

export interface IngestResponse {
  sessionId: string | null;
  totalParsed: number;
  inserted: number;
  duplicates: number;
}

export interface SolverActionResult {
  action: "check" | "bet" | "call" | "fold" | "raise";
  sizeBB?: number;
  frequency: number;
  evBB: number;
}

export interface SolverResult {
  spotHash: string;
  source: "river-fixed-bet-cfr";
  mode: "heads-up-river-fixed-bet";
  status: "solved";
  iterations: number;
  exploitabilityBB: number;
  actions: SolverActionResult[];
  handStrategy?: {
    combo: string;
    inHeroRange: boolean;
    actions: SolverActionResult[];
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

export interface SolverSolveRequest {
  spot: Spot;
  heroRange: string;
  villainRange: string;
  tree?: {
    betSizeBB?: number;
    iterations?: number;
    seed?: number;
  };
}

export interface SolverSolveResponse {
  cached: boolean;
  solvedAt: string;
  iterations: number;
  result: SolverResult;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; service: string; dbPath: string; handCount: number }>("/health"),
  listSessions: () => get<{ sessions: Session[] }>("/sessions"),
  getSession: (id: string) => get<Session>(`/sessions/${id}`),
  listHands: (sessionId: string) => get<{ hands: HandListItem[] }>(`/sessions/${sessionId}/hands`),
  getHand: (id: string) => get<Hand>(`/hands/${id}`),
  getHandDecisions: (id: string) => get<{ grades: Grade[] }>(`/hands/${id}/decisions`),
  solveDecisionDeep: (id: string, index: number) =>
    post<{ cached: boolean; iterations: number; solvedAt: string; grade: Grade }>(
      `/hands/${id}/decisions/${index}/solve`,
      {},
    ),
  createGame: (body: CreateGameBody) => post<{ id: string; view: GameView }>("/game", body),
  getGame: (id: string) => get<{ view: GameView }>(`/game/${id}`),
  gameAction: (id: string, body: GameActionBody) =>
    post<{ view: GameView }>(`/game/${id}/action`, body),
  gameNext: (id: string) => post<{ view: GameView }>(`/game/${id}/next`, {}),
  gameHint: (id: string) => get<{ advice: CoachAdvice }>(`/game/${id}/hint`),
  gameReview: (id: string) => get<{ grades: Grade[] }>(`/game/${id}/review`),
  solveSpot: (body: SolverSolveRequest) => post<SolverSolveResponse>("/solver/solve", body),
  uploadSession: async (file: File): Promise<IngestResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/sessions", { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`upload: ${res.status} ${body}`);
    }
    return res.json() as Promise<IngestResponse>;
  },
};
