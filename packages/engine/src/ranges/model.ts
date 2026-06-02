import type { Action, Card, Hand, Position, Spot, Street } from "@poker/shared";
import { type GameFormat, findChart } from "../charts.js";
import { type WeightedCombo, expandRangeToCombos } from "../combos.js";
import { inferDepth } from "../depth.js";
import { comboCount } from "../handClass.js";
import { type RangeWeights, compileRange } from "../range.js";
import type { PlayerProfile } from "./profile.js";
import { CLASSES_BY_STRENGTH, MadeHand, madeHand } from "./strength.js";

export type PreflopRole =
  | "rfi"
  | "3bet"
  | "cold-call"
  | "bb-defend"
  | "limp"
  | "folded"
  | "unknown";

export interface ModeledRange {
  /** Concrete villain combos with weights, narrowed through the streets seen so far. */
  combos: WeightedCombo[];
  role: PreflopRole;
  /** "chart" when a shipped GTO chart seeded the preflop range, else a strength-band default. */
  source: "chart" | "default";
  notes: string;
}

/** Typical small-stakes 6-max population baselines (fractions), for shrinkage. */
const POPULATION = { vpip: 0.24, pfr: 0.19, threeBet: 0.07 } as const;
const SHRINK_K = 60; // hands before observed stats dominate the prior

const STREET_ORDER: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3 };

const TOTAL_COMBOS = 1326;

const RAISE_TYPES: ReadonlySet<Action["type"]> = new Set(["raise", "all-in"]);

/** Classify what a villain's preflop line was, to pick the right base range shape. */
function classifyRole(
  preflop: Action[],
  villain: string,
  position: Position,
): { role: PreflopRole; vsOpenFrom?: Position } {
  let raises = 0;
  let firstAction: Action | undefined;
  let raisedFacingRaise = false;
  let calledFacingRaise = false;
  let openRaised = false;
  let folded = false;
  let openerPos: Position | undefined;
  const posByActor = new Map<string, Position>();

  for (const a of preflop) {
    if (a.type.startsWith("post-")) continue;
    if (a.actor === villain && !firstAction) firstAction = a;
    if (a.actor === villain) {
      if (a.type === "fold") folded = true;
      if (RAISE_TYPES.has(a.type)) {
        if (raises === 0) openRaised = true;
        else raisedFacingRaise = true;
      }
      if (a.type === "call" && raises >= 1) calledFacingRaise = true;
    }
    if (RAISE_TYPES.has(a.type)) {
      if (raises === 0) openerPos = posByActor.get(a.actor);
      raises++;
    }
    posByActor.set(a.actor, position); // only villain's position matters downstream
  }

  if (folded && !openRaised && !raisedFacingRaise && !calledFacingRaise) {
    return { role: "folded" };
  }
  if (raisedFacingRaise) return { role: "3bet", vsOpenFrom: openerPos };
  if (openRaised) return { role: "rfi" };
  if (calledFacingRaise) return { role: "cold-call", vsOpenFrom: openerPos };
  if (firstAction && (firstAction.type === "call" || firstAction.type === "check")) {
    return { role: position === "BB" ? "bb-defend" : "limp" };
  }
  return { role: "unknown" };
}

function rangeFraction(weights: RangeWeights): number {
  let combos = 0;
  for (const [cls, w] of Object.entries(weights)) combos += comboCount(cls) * w;
  return combos / TOTAL_COMBOS;
}

/** Classes whose cumulative strength-rank fraction falls in [fromFrac, toFrac). */
function bandRange(fromFrac: number, toFrac: number): RangeWeights {
  const weights: RangeWeights = {};
  let cumulative = 0;
  for (const cls of CLASSES_BY_STRENGTH) {
    const frac = comboCount(cls) / TOTAL_COMBOS;
    const mid = cumulative + frac / 2;
    if (mid >= fromFrac && mid < toFrac) weights[cls] = 1;
    cumulative += frac;
  }
  return weights;
}

/** Widen (add strongest absent classes) or tighten (drop weakest present) to hit a target fraction. */
function adjustWidth(base: RangeWeights, targetFrac: number): RangeWeights {
  const weights: RangeWeights = { ...base };
  let frac = rangeFraction(weights);

  if (targetFrac > frac) {
    for (const cls of CLASSES_BY_STRENGTH) {
      if (frac >= targetFrac) break;
      if ((weights[cls] ?? 0) >= 1) continue;
      weights[cls] = 1;
      frac = rangeFraction(weights);
    }
  } else if (targetFrac < frac) {
    for (let i = CLASSES_BY_STRENGTH.length - 1; i >= 0 && frac > targetFrac; i--) {
      const cls = CLASSES_BY_STRENGTH[i]!;
      if (!weights[cls]) continue;
      delete weights[cls];
      frac = rangeFraction(weights);
    }
  }
  return weights;
}

/** Base preflop range for a role, preferring a shipped chart, else a strength band. */
function baseRange(
  role: PreflopRole,
  position: Position,
  depth: { format: GameFormat; stackBB: number },
): { weights: RangeWeights; source: "chart" | "default" } {
  if (role === "rfi") {
    const chart = findChart({ ...depth, position, scenario: "RFI" });
    if (chart) {
      const weights: RangeWeights = {};
      for (const a of chart.actions) Object.assign(weights, compileRange(a.range));
      return { weights, source: "chart" };
    }
  }
  // Strength-band defaults (fractions of all starting hands).
  switch (role) {
    case "rfi":
      return { weights: bandRange(0, openFraction(position)), source: "default" };
    case "3bet":
      return { weights: bandRange(0, 0.06), source: "default" };
    case "cold-call":
      return { weights: bandRange(0.06, 0.22), source: "default" };
    case "bb-defend":
      return { weights: bandRange(0, 0.55), source: "default" };
    case "limp":
      return { weights: bandRange(0.1, 0.35), source: "default" };
    default:
      return { weights: bandRange(0, 0.3), source: "default" };
  }
}

function openFraction(position: Position): number {
  const byPos: Partial<Record<Position, number>> = {
    UTG: 0.16,
    MP: 0.18,
    LJ: 0.19,
    HJ: 0.21,
    CO: 0.27,
    BTN: 0.42,
    SB: 0.4,
  };
  return byPos[position] ?? 0.2;
}

/** Blend the base width toward the player's observed tendency, shrunk by sample size. */
function profileTarget(role: PreflopRole, baseFrac: number, profile?: PlayerProfile): number {
  if (!profile) return baseFrac;
  const aggressive = role === "rfi" || role === "3bet";
  const stat = role === "3bet" ? profile.threeBet : aggressive ? profile.pfr : profile.vpip;
  const pop = role === "3bet" ? POPULATION.threeBet : aggressive ? POPULATION.pfr : POPULATION.vpip;
  const opps = role === "3bet" ? profile.threeBetOpps : profile.preflopOpps;
  if (pop <= 0 || opps <= 0) return baseFrac;

  const ratio = stat / pop;
  const raw = baseFrac * ratio;
  const w = opps / (opps + SHRINK_K);
  return Math.min(1, Math.max(0.01, baseFrac + w * (raw - baseFrac)));
}

const VALUE = new Set([MadeHand.TopPairOrSecond, MadeHand.TwoPairPlus, MadeHand.Nuts]);

/** Reweight a combo for one villain action on `board`. 0 weight ⇒ removed from range. */
function actionWeight(bucket: MadeHand, action: Action["type"]): number {
  switch (action) {
    case "bet":
    case "raise":
    case "all-in":
      if (VALUE.has(bucket)) return 1;
      if (bucket === MadeHand.StrongDraw) return 0.6;
      if (bucket === MadeHand.WeakPair) return 0.3;
      if (bucket === MadeHand.WeakDraw) return 0.2;
      return 0.12; // air bluffs keep the range polar but mostly strong
    case "call":
      if (bucket === MadeHand.Nuts || bucket === MadeHand.TwoPairPlus) return 0.4;
      if (bucket === MadeHand.TopPairOrSecond) return 1;
      if (bucket === MadeHand.WeakPair) return 1;
      if (bucket === MadeHand.StrongDraw) return 0.9;
      if (bucket === MadeHand.WeakDraw) return 0.5;
      return 0.05;
    case "check":
      if (bucket === MadeHand.Nuts || bucket === MadeHand.TwoPairPlus) return 0.55;
      return 1;
    default:
      return 1;
  }
}

/** Apply each of the villain's actions on a street to narrow + reweight their combos. */
function narrow(combos: WeightedCombo[], board: Card[], actions: Action[]): WeightedCombo[] {
  if (actions.length === 0 || board.length === 0) return combos;
  let current = combos;
  for (const action of actions) {
    if (action.type === "fold") return [];
    current = current
      .map((combo) => ({
        cards: combo.cards,
        weight: combo.weight * actionWeight(madeHand(combo.cards, board), action.type),
      }))
      .filter((c) => c.weight > 1e-4);
  }
  return current;
}

export interface ModelOpts {
  profile?: PlayerProfile;
}

/**
 * Model one villain's holding range as of a hero decision (`spot`): classify their
 * preflop line → seed a base range (chart or strength band) → adjust width for the
 * player's observed tendencies (shrunk by sample size) → narrow by their postflop
 * actions on every street up to the spot. Returns concrete weighted combos.
 */
export function modelVillainRange(
  hand: Hand,
  spot: Spot,
  villain: string,
  opts: ModelOpts = {},
): ModeledRange {
  const position = hand.seats.find((s) => s.player === villain)?.position;
  const preflop = hand.streets.find((s) => s.street === "preflop")?.actions ?? [];
  if (!position) {
    return { combos: [], role: "unknown", source: "default", notes: `${villain}: unknown seat` };
  }

  const { role } = classifyRole(preflop, villain, position);
  if (role === "folded") {
    return { combos: [], role, source: "default", notes: `${villain} folded preflop` };
  }

  const depth = inferDepth(spot.effectiveStackBB);
  const { weights: base, source } = baseRange(role, position, depth);
  const target = profileTarget(role, rangeFraction(base), opts.profile);
  const adjusted = adjustWidth(base, target);

  const dead = [...spot.heroCards, ...spot.board];
  let combos = expandRangeToCombos(adjusted, dead);

  // Narrow by this villain's postflop actions up to (not including) the hero decision.
  for (const street of hand.streets) {
    if (street.street === "preflop") continue;
    if (STREET_ORDER[street.street] > STREET_ORDER[spot.street]) break;
    const onSpotStreet = street.street === spot.street;
    const villainActions = street.actions.filter(
      (a, i) => a.actor === villain && (!onSpotStreet || i < spot.actionIndex),
    );
    combos = narrow(combos, street.board, villainActions);
  }

  const notes = `${villain} ${role} from ${position} (${source}, ${Math.round(target * 100)}% preflop, ${combos.length} combos)`;
  return { combos, role, source, notes };
}
