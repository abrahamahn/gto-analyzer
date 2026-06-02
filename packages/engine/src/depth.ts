import type { GameFormat } from "./charts.js";

/** Map an effective stack depth (bb) to the closest shipped chart pack. */
export function inferDepth(effectiveStackBB: number): { format: GameFormat; stackBB: number } {
  if (effectiveStackBB >= 60) return { format: "cash", stackBB: 100 };
  if (effectiveStackBB >= 30) return { format: "mtt", stackBB: 40 };
  if (effectiveStackBB >= 14) return { format: "mtt", stackBB: 20 };
  return { format: "mtt", stackBB: 10 };
}
