import type {
  Action,
  Decision,
  Grade,
  GradeAction,
  GradeConfidence,
  GradeVerdict,
  Hand,
} from "@poker/shared";
import { type ChartAction, evaluateHand, findChart } from "./charts.js";
import type { WeightedCombo } from "./combos.js";
import { extractDecisions } from "./decisions.js";
import { inferDepth } from "./depth.js";
import { type Candidate, type Rake, rolloutSpot } from "./ev/rollout.js";
import { handClass } from "./handClass.js";
import { type PostflopActionResult, solvePostflop } from "./postflop.js";
import { modelVillainRange } from "./ranges/model.js";
import type { PlayerProfile } from "./ranges/profile.js";

const AGGRESSIVE: ReadonlySet<Action["type"]> = new Set(["raise", "bet", "all-in"]);
/** EV-loss (bb) thresholds for the verdict label over the real number. */
const VERDICT_BANDS: ReadonlyArray<[number, GradeVerdict]> = [
  [0.1, "optimal"],
  [0.5, "minor"],
  [2, "suspect"],
];
/** Softmax temperature (bb) turning EVs into an approximate optimal-agent policy. */
const POLICY_TEMPERATURE = 1;

export interface GradeOptions {
  hand: Hand;
  decision: Decision;
  profiles?: Map<string, PlayerProfile>;
  /** Monte Carlo rollout iterations (multiway / facing-raise spots). */
  iterations?: number;
  /** Heads-up postflop CFR iterations; higher = lower exploitability. */
  solverIterations?: number;
  /** House rake to subtract from won pots (omit for rake-free GTO study). */
  rake?: Rake;
}

function verdictFor(evLossBB: number): GradeVerdict {
  for (const [bound, verdict] of VERDICT_BANDS) if (evLossBB < bound) return verdict;
  return "blunder";
}

/**
 * Verdict for a preflop spot a GTO chart covers: the chart is the authoritative
 * equilibrium strategy, so we judge by how much frequency it assigns to hero's
 * action rather than by the rollout's immediate-EV lower bound (which can't see
 * postflop value). This is strategy deviation against a solved range, not a
 * fabricated EV constant — the EV table still reports real rollout numbers.
 */
function chartVerdict(chosenFrequency: number): GradeVerdict {
  if (chosenFrequency >= 0.5) return "optimal";
  if (chosenFrequency >= 0.15) return "minor";
  if (chosenFrequency > 0.01) return "suspect";
  return "blunder";
}

/** The candidates we price: fold (when facing a bet), the passive option, and one raise/bet. */
function candidatesFor(toCallBB: number, potBB: number): Candidate[] {
  const candidates: Candidate[] = [];
  if (toCallBB > 1e-9) candidates.push({ type: "fold" });
  candidates.push(toCallBB > 1e-9 ? { type: "call" } : { type: "check" });
  if (toCallBB > 1e-9) {
    candidates.push({ type: "raise", sizeBB: Math.max(toCallBB * 2.5, potBB * 0.5) });
  } else {
    candidates.push({ type: "bet", sizeBB: Math.max(potBB * 0.66, 1) });
  }
  return candidates;
}

/** The candidate category hero's actual action maps onto. */
function chosenCategory(heroType: Action["type"]): "fold" | "passive" | "aggressive" {
  if (heroType === "fold") return "fold";
  if (AGGRESSIVE.has(heroType)) return "aggressive";
  return "passive";
}

function categoryOf(type: Action["type"]): "fold" | "passive" | "aggressive" {
  if (type === "fold") return "fold";
  if (AGGRESSIVE.has(type)) return "aggressive";
  return "passive";
}

/** Collapse a chart's mixed strategy into fold / passive / aggressive frequencies. */
function chartFrequencies(mix: ChartAction[]): Record<"fold" | "passive" | "aggressive", number> {
  const freq = { fold: 0, passive: 0, aggressive: 0 };
  for (const m of mix) freq[categoryOf(m.type)] += m.frequency;
  return freq;
}

/** Softmax over EVs → a policy that mostly takes the best action (not a true equilibrium). */
function softmaxPolicy(evs: number[]): number[] {
  const max = Math.max(...evs);
  const weights = evs.map((ev) => Math.exp((ev - max) / POLICY_TEMPERATURE));
  const total = weights.reduce((s, w) => s + w, 0);
  return total > 0 ? weights.map((w) => w / total) : evs.map(() => 1 / evs.length);
}

function liveVillains(hand: Hand, decision: Decision): string[] {
  const folded = new Set(
    decision.spot.priorActions.filter((a) => a.type === "fold").map((a) => a.actor),
  );
  return hand.seats.map((s) => s.player).filter((p) => p !== hand.hero && !folded.has(p));
}

function unknownGrade(decision: Decision, notes: string): Grade {
  return {
    decision,
    verdict: "unknown",
    chosenEvBB: 0,
    bestEvBB: 0,
    evLossBB: 0,
    actions: [],
    confidence: "approximate",
    source: "unknown",
    notes,
  };
}

/**
 * Grade a hero decision with real EV. Each candidate (fold / passive / raise) is
 * priced by Monte Carlo rollout against per-villain modeled ranges; the verdict is
 * derived from `evLossBB = bestEv − chosenEv`, never a fabricated constant. Action
 * frequencies come from a GTO chart when one covers the spot (preflop), otherwise
 * from an EV-softmax policy. Confidence is labeled solved / modeled / approximate.
 */
export function gradeDecision(opts: GradeOptions): Grade {
  const { hand, decision, profiles, iterations, solverIterations, rake } = opts;
  const { spot, heroAction } = decision;

  const villains = liveVillains(hand, decision);
  const villainCombos = villains
    .map((v) => modelVillainRange(hand, spot, v, { profile: profiles?.get(v) }).combos)
    .filter((c) => c.length > 0);

  if (villainCombos.length === 0) {
    return unknownGrade(decision, "no live villain with a modeled range");
  }

  // Heads-up postflop → solve the real equilibrium (confidence "solved").
  if (spot.street !== "preflop" && villainCombos.length === 1) {
    const solved = solvedHeadsUpGrade(
      hand,
      decision,
      villainCombos[0]!,
      profiles,
      solverIterations,
      rake,
    );
    if (solved) return solved;
  }

  const candidates = candidatesFor(spot.toCallBB, spot.potBB);
  const rollout = rolloutSpot({
    spot,
    villains: villainCombos,
    candidates,
    iterations,
    rake,
  });

  // Preflop chart frequencies, when a chart covers this exact spot.
  const chartFreq = preflopChartFrequencies(decision);

  const evs = rollout.actions.map((a) => a.evBB);
  const policy = softmaxPolicy(evs);

  const chosenCat = chosenCategory(heroAction.type);
  const actions: GradeAction[] = rollout.actions.map((a, i): GradeAction => {
    const cat = categoryOf(a.type);
    const action: GradeAction = { type: a.type, evBB: a.evBB };
    if (a.sizeBB !== undefined) action.sizeBB = a.sizeBB;
    if (a.stderrBB > 0) action.stderrBB = a.stderrBB;
    if (a.villainFoldPct !== undefined) action.villainFoldPct = a.villainFoldPct;
    action.frequency = chartFreq ? chartFreq[cat] : policy[i];
    if (cat === chosenCat) action.chosen = true;
    return action;
  });

  const chosen = actions.find((a) => a.chosen) ?? actions[0]!;
  const bestEvBB = Math.max(...actions.map((a) => a.evBB));
  const chosenEvBB = chosen.evBB;
  const evLossBB = Math.max(0, bestEvBB - chosenEvBB);

  const verdict = chartFreq ? chartVerdict(chartFreq[chosenCat]) : verdictFor(evLossBB);
  const confidence: GradeConfidence = chartFreq ? "solved" : rollout.confidence;
  const source = chartFreq
    ? "preflop-chart"
    : villainCombos.length > 1
      ? "multiway-rollout"
      : "rollout-ev";

  return {
    decision,
    verdict,
    chosenEvBB,
    bestEvBB,
    evLossBB,
    actions,
    confidence,
    source,
    iterations: rollout.iterations,
    notes: describe(decision, chartFreq, villainCombos.length),
  };
}

/** True when hero is the first player to act on the current street (out of position). */
function heroActsFirst(hand: Hand, decision: Decision): boolean {
  const { spot } = decision;
  const street = hand.streets.find((s) => s.street === spot.street);
  if (!street) return true;
  return !street.actions
    .slice(0, spot.actionIndex)
    .some(
      (a) =>
        a.actor !== hand.hero &&
        (a.type === "check" || a.type === "bet" || a.type === "call" || a.type === "raise"),
    );
}

/** Ensure hero's actual holding is in their modeled range so the solver can read its strategy. */
function withHeroHand(combos: WeightedCombo[], spot: Decision["spot"]): WeightedCombo[] {
  const key = [spot.heroCards[0], spot.heroCards[1]]
    .map((c) => `${c.rank}${c.suit}`)
    .sort()
    .join("");
  const present = combos.some(
    (c) =>
      [c.cards[0], c.cards[1]]
        .map((x) => `${x.rank}${x.suit}`)
        .sort()
        .join("") === key,
  );
  if (present) return combos;
  const avgWeight = combos.length ? combos.reduce((s, c) => s + c.weight, 0) / combos.length : 1;
  return [...combos, { cards: spot.heroCards, weight: avgWeight }];
}

/** Build a "solved" grade from a heads-up postflop CFR solve, or null if it cannot run. */
function solvedHeadsUpGrade(
  hand: Hand,
  decision: Decision,
  villainCombos: WeightedCombo[],
  profiles: Map<string, PlayerProfile> | undefined,
  solverIterations: number | undefined,
  rake: Rake | undefined,
): Grade | null {
  const { spot, heroAction } = decision;
  const heroCombos = withHeroHand(
    modelVillainRange(hand, spot, hand.hero, { profile: profiles?.get(hand.hero) }).combos,
    spot,
  );
  if (heroCombos.length === 0) return null;

  // Deeper solves widen the combo cap too, so the equilibrium is over more hands.
  const deep = solverIterations !== undefined && solverIterations > 800;
  let solved: ReturnType<typeof solvePostflop>;
  try {
    solved = solvePostflop({
      spot,
      heroCombos,
      villainCombos,
      heroActsFirst: heroActsFirst(hand, decision),
      iterations: Math.min(Math.max(solverIterations ?? 400, 100), 6000),
      maxCombos: deep ? 220 : 120,
      rake,
    });
  } catch {
    return null;
  }

  const solverActions =
    solved.handStrategy?.inHeroRange && solved.handStrategy.actions.length
      ? solved.handStrategy.actions
      : solved.actions;
  if (solverActions.length === 0) return null;

  const chosenCat = chosenCategory(heroAction.type);
  const actions: GradeAction[] = solverActions.map((a: PostflopActionResult): GradeAction => {
    const action: GradeAction = { type: a.action, evBB: a.evBB, frequency: a.frequency };
    if (a.sizeBB !== undefined) action.sizeBB = a.sizeBB;
    return action;
  });
  // Mark the chosen category's best-EV action as the one hero took.
  const inCategory = actions.filter((a) => categoryOf(a.type) === chosenCat);
  const chosen = inCategory.reduce<GradeAction | undefined>(
    (best, a) => (!best || a.evBB > best.evBB ? a : best),
    undefined,
  );
  if (chosen) chosen.chosen = true;

  const bestEvBB = Math.max(...actions.map((a) => a.evBB));
  const chosenEvBB = chosen?.evBB ?? bestEvBB;
  const evLossBB = Math.max(0, bestEvBB - chosenEvBB);

  return {
    decision,
    verdict: verdictFor(evLossBB),
    chosenEvBB,
    bestEvBB,
    evLossBB,
    actions,
    confidence: "solved",
    source: "hu-cfr",
    iterations: solved.iterations,
    notes: `${spot.street} heads-up GTO solve (${solved.realization}); exploitability ${solved.exploitabilityBB.toFixed(2)}bb.`,
  };
}

/** Grade every voluntary hero decision in a hand. */
export function gradeHand(
  hand: Hand,
  opts: {
    profiles?: Map<string, PlayerProfile>;
    iterations?: number;
    solverIterations?: number;
    rake?: Rake;
  } = {},
): Grade[] {
  return extractDecisions(hand).map((decision) =>
    gradeDecision({
      hand,
      decision,
      profiles: opts.profiles,
      iterations: opts.iterations,
      solverIterations: opts.solverIterations,
      rake: opts.rake,
    }),
  );
}

function preflopChartFrequencies(
  decision: Decision,
): Record<"fold" | "passive" | "aggressive", number> | undefined {
  const { spot } = decision;
  if (spot.street !== "preflop") return undefined;
  if (spot.priorActions.some((a) => AGGRESSIVE.has(a.type))) return undefined; // RFI/jam only

  const { format, stackBB } = inferDepth(spot.effectiveStackBB);
  const scenario = stackBB <= 10 ? "Push/fold (jam)" : "RFI";
  const chart = findChart({ format, stackBB, position: spot.heroPosition, scenario });
  if (!chart) return undefined;
  return chartFrequencies(evaluateHand(chart, handClass(spot.heroCards[0], spot.heroCards[1])));
}

function describe(
  decision: Decision,
  chartFreq: Record<string, number> | undefined,
  villainCount: number,
): string {
  const { spot } = decision;
  const where = `${spot.street} from ${spot.heroPosition}`;
  if (chartFreq) {
    return `${handClass(spot.heroCards[0], spot.heroCards[1])} ${where}: graded vs GTO preflop chart.`;
  }
  const players = villainCount === 1 ? "heads-up" : `${villainCount}-way`;
  return `${where}: EV from rollout vs ${players} modeled range(s).`;
}
