import { equityVsRanges } from "@poker/engine";
import type { EquitySimulationRequest, EquitySimulationResponse } from "../lib/equitySimulation.js";

globalThis.addEventListener("message", (event: MessageEvent<EquitySimulationRequest>) => {
  const { id, payload } = event.data;
  try {
    const result = equityVsRanges({
      hero: payload.hero,
      board: payload.board,
      villainRanges: Array.from({ length: payload.opponents }, () => payload.villainRange),
      iterations: payload.iterations,
    });
    const response: EquitySimulationResponse = { id, ok: true, result };
    globalThis.postMessage(response);
  } catch (err) {
    const response: EquitySimulationResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : "simulation failed",
    };
    globalThis.postMessage(response);
  }
});
