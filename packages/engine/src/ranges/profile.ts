import type { Action, Hand } from "@poker/shared";

/**
 * Observed tendencies for one opponent, accumulated across imported hands. These
 * drive the per-player adaptive range model: a player whose VPIP/PFR exceed the
 * population baseline gets a wider modeled range, and vice versa. All rates are
 * fractions in [0, 1]; `*Opps` are the denominators (for sample-size shrinkage).
 */
export interface PlayerProfile {
  player: string;
  /** Hands where the player had a voluntary preflop choice. */
  preflopOpps: number;
  /** Voluntarily put money in preflop (call/raise), not just posting the blind. */
  vpip: number;
  /** Raised or shoved preflop. */
  pfr: number;
  /** Hands where the player faced a preflop raise before their first action. */
  threeBetOpps: number;
  /** Re-raised (3bet+) facing a preflop raise. */
  threeBet: number;
  /** Postflop actions that were a bet or raise, over all postflop actions taken. */
  postflopActions: number;
  aggression: number;
}

interface Counters {
  preflopOpps: number;
  vpip: number;
  pfr: number;
  threeBetOpps: number;
  threeBet: number;
  postflopActions: number;
  aggressive: number;
}

const VOLUNTARY_IN: ReadonlySet<Action["type"]> = new Set(["call", "raise", "all-in"]);
const RAISE_TYPES: ReadonlySet<Action["type"]> = new Set(["raise", "all-in"]);

function emptyCounters(): Counters {
  return {
    preflopOpps: 0,
    vpip: 0,
    pfr: 0,
    threeBetOpps: 0,
    threeBet: 0,
    postflopActions: 0,
    aggressive: 0,
  };
}

function accumulatePreflop(hand: Hand, counters: Map<string, Counters>): void {
  const preflop = hand.streets.find((s) => s.street === "preflop");
  if (!preflop) return;

  const acted = new Set<string>();
  let raisesSoFar = 0;
  for (const action of preflop.actions) {
    if (action.type.startsWith("post-")) continue;
    const c = counters.get(action.actor) ?? emptyCounters();
    counters.set(action.actor, c);

    if (!acted.has(action.actor)) {
      acted.add(action.actor);
      c.preflopOpps++;
      if (VOLUNTARY_IN.has(action.type)) c.vpip++;
      if (RAISE_TYPES.has(action.type)) c.pfr++;
      if (raisesSoFar >= 1) {
        c.threeBetOpps++;
        if (RAISE_TYPES.has(action.type)) c.threeBet++;
      }
    }
    if (RAISE_TYPES.has(action.type)) raisesSoFar++;
  }
}

function accumulatePostflop(hand: Hand, counters: Map<string, Counters>): void {
  for (const street of hand.streets) {
    if (street.street === "preflop") continue;
    for (const action of street.actions) {
      if (action.type === "fold") continue;
      const c = counters.get(action.actor) ?? emptyCounters();
      counters.set(action.actor, c);
      c.postflopActions++;
      if (action.type === "bet" || action.type === "raise" || action.type === "all-in") {
        c.aggressive++;
      }
    }
  }
}

function finalize(player: string, c: Counters): PlayerProfile {
  return {
    player,
    preflopOpps: c.preflopOpps,
    vpip: c.preflopOpps > 0 ? c.vpip / c.preflopOpps : 0,
    pfr: c.preflopOpps > 0 ? c.pfr / c.preflopOpps : 0,
    threeBetOpps: c.threeBetOpps,
    threeBet: c.threeBetOpps > 0 ? c.threeBet / c.threeBetOpps : 0,
    postflopActions: c.postflopActions,
    aggression: c.postflopActions > 0 ? c.aggressive / c.postflopActions : 0,
  };
}

/** Aggregate per-player preflop and postflop tendencies across a corpus of hands. */
export function buildProfiles(hands: Hand[]): Map<string, PlayerProfile> {
  const counters = new Map<string, Counters>();
  for (const hand of hands) {
    accumulatePreflop(hand, counters);
    accumulatePostflop(hand, counters);
  }
  const profiles = new Map<string, PlayerProfile>();
  for (const [player, c] of counters) profiles.set(player, finalize(player, c));
  return profiles;
}
