import type { ActionType } from "@poker/shared";

/** Solver-grid colours, keyed by action family. Bet/raise warm, call green, fold cool. */
export const ACTION_COLOR: Record<ActionType, string> = {
  raise: "#e0564f",
  bet: "#e0564f",
  "all-in": "#b4257a",
  call: "#3fa66a",
  check: "#5b8def",
  fold: "#3a3f4b",
  "post-sb": "#3a3f4b",
  "post-bb": "#3a3f4b",
  "post-ante": "#3a3f4b",
};

export const ACTION_LABEL: Record<ActionType, string> = {
  raise: "Raise",
  bet: "Bet",
  "all-in": "All-in",
  call: "Call",
  check: "Check",
  fold: "Fold",
  "post-sb": "SB",
  "post-bb": "BB",
  "post-ante": "Ante",
};

/** Order actions for stacked rendering: aggression on top, fold at the bottom. */
const ORDER: ActionType[] = ["all-in", "raise", "bet", "call", "check", "fold"];

export function sortActions<T extends { type: ActionType }>(actions: T[]): T[] {
  return [...actions].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}
