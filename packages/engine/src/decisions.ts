import type { Action, Decision, Hand, Spot } from "@poker/shared";

/** Hero action types that represent a real choice (posts are forced, not graded). */
const VOLUNTARY: ReadonlySet<Action["type"]> = new Set([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "all-in",
]);

interface ReplayState {
  /** Whole-hand chips each player has put in (currency units), incl. antes/blinds. */
  committed: Map<string, number>;
  /** Voluntary chips toward the current street's line; reset each street. Excludes antes. */
  streetIn: Map<string, number>;
  folded: Set<string>;
  startingStack: Map<string, number>;
}

function committedOf(state: ReplayState, player: string): number {
  return state.committed.get(player) ?? 0;
}

function remainingOf(state: ReplayState, player: string): number {
  return (state.startingStack.get(player) ?? 0) - committedOf(state, player);
}

function streetInOf(state: ReplayState, player: string): number {
  return state.streetIn.get(player) ?? 0;
}

/** Current amount that must be matched this street (the high water mark of voluntary chips in). */
function lineOf(state: ReplayState): number {
  let line = 0;
  for (const v of state.streetIn.values()) if (v > line) line = v;
  return line;
}

/**
 * Apply one action to the running betting state. Amount conventions follow the
 * CoinPoker parser: `call` carries the increment added; `bet`/`raise`/blind posts
 * carry the absolute street level reached; `all-in` commits the player's entire
 * remaining stack (its parsed amount is ambiguous between to-level and increment,
 * so we derive the increment from the stack); antes are dead money.
 */
function applyAction(state: ReplayState, action: Action): void {
  const { actor, type, amount } = action;
  const committed = committedOf(state, actor);
  const streetIn = streetInOf(state, actor);

  switch (type) {
    case "fold":
      state.folded.add(actor);
      return;
    case "check":
      return;
    case "post-ante":
      state.committed.set(actor, committed + (amount ?? 0));
      return;
    case "post-sb":
    case "post-bb":
    case "bet":
    case "raise": {
      const to = amount ?? streetIn;
      const increment = Math.max(0, to - streetIn);
      state.committed.set(actor, committed + increment);
      state.streetIn.set(actor, to);
      return;
    }
    case "call": {
      const increment = amount ?? 0;
      state.committed.set(actor, committed + increment);
      state.streetIn.set(actor, streetIn + increment);
      return;
    }
    case "all-in": {
      const increment = Math.max(0, remainingOf(state, actor));
      state.committed.set(actor, committed + increment);
      state.streetIn.set(actor, streetIn + increment);
      return;
    }
  }
}

/**
 * Turn a parsed hand into the ordered list of hero decision points, each carrying
 * the game state immediately before hero acts (pot, amount to call, effective stack,
 * board, prior actions) in big-blind units. Forced posts and spots where hero is
 * already all-in are skipped. Hands where hero's cards are unknown yield nothing.
 */
export function extractDecisions(hand: Hand): Decision[] {
  if (!hand.heroCards) return [];
  const heroCards = hand.heroCards;
  const heroPosition = hand.seats.find((s) => s.player === hand.hero)?.position;
  if (!heroPosition) return [];

  const bb = hand.bigBlind;
  const state: ReplayState = {
    committed: new Map(),
    streetIn: new Map(),
    folded: new Set(),
    startingStack: new Map(hand.seats.map((s) => [s.player, s.stack])),
  };
  const villains = hand.seats.map((s) => s.player).filter((p) => p !== hand.hero);

  const priorActions: Action[] = [];
  const decisions: Decision[] = [];

  for (const street of hand.streets) {
    state.streetIn = new Map();

    for (let actionIndex = 0; actionIndex < street.actions.length; actionIndex++) {
      const action = street.actions[actionIndex]!;

      if (
        action.actor === hand.hero &&
        VOLUNTARY.has(action.type) &&
        remainingOf(state, hand.hero) > 1e-9
      ) {
        const heroRemaining = remainingOf(state, hand.hero);
        const toCall = Math.max(0, lineOf(state) - streetInOf(state, hand.hero));
        const pot = [...state.startingStack.keys()].reduce((s, p) => s + committedOf(state, p), 0);
        const liveVillainStacks = villains
          .filter((p) => !state.folded.has(p))
          .map((p) => remainingOf(state, p))
          .filter((r) => r > 1e-9);
        const effective = liveVillainStacks.length
          ? Math.min(heroRemaining, Math.max(...liveVillainStacks))
          : heroRemaining;

        const spot: Spot = {
          handId: hand.handId,
          street: street.street,
          actionIndex,
          heroPosition,
          effectiveStackBB: Math.max(effective / bb, 1e-9),
          potBB: pot / bb,
          toCallBB: toCall / bb,
          board: street.board,
          heroCards,
          priorActions: [...priorActions],
        };
        decisions.push({ spot, heroAction: action });
      }

      applyAction(state, action);
      priorActions.push(action);
    }
  }

  return decisions;
}
