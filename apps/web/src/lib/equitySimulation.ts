import type { EquityResult } from "@poker/engine";
import type { Card } from "@poker/shared";

export interface EquitySimulationPayload {
  hero: [Card, Card];
  board: Card[];
  villainRange: Array<[Card, Card]>;
  opponents: number;
  iterations: number;
}

export interface EquitySimulationRequest {
  id: number;
  payload: EquitySimulationPayload;
}

export type EquitySimulationResponse =
  | { id: number; ok: true; result: EquityResult }
  | { id: number; ok: false; error: string };
