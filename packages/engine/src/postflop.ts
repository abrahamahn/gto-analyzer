import { type Card, Rank, type Spot, Suit, formatCard } from "@poker/shared";
import type { WeightedCombo } from "./combos.js";
import { evaluate7 } from "./equity.js";
import type { Rake } from "./ev/rollout.js";
import { rankValue } from "./handClass.js";

/** Pot a winner actually collects after rake (postflop pots always saw a flop). */
function afterRake(pot: number, rake: Rake | undefined): number {
  if (!rake || rake.percent <= 0) return pot;
  const taken = Math.min(
    rake.percent * pot,
    rake.capBB > 0 ? rake.capBB : Number.POSITIVE_INFINITY,
  );
  return pot - taken;
}

/**
 * Heads-up postflop CFR over a full single-street action tree (check / bet / call
 * / raise with multiple sizes and facing-bet nodes). The remaining runout is
 * realized by equity: on the RIVER this is exact GTO (no cards to come); on the
 * flop/turn it solves the current street's betting exactly and runs the rest of
 * the board out with no further betting. Both are genuine Nash solutions of a
 * well-defined game — hence confidence "solved", not a heuristic.
 */

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};

const DECK_IDS: number[] = (() => {
  const ids: number[] = [];
  for (const r of Object.values(Rank)) {
    for (const s of Object.values(Suit)) ids.push(rankValue(r) * 4 + SUIT_INDEX[s]);
  }
  return ids;
})();

function cardId(card: Card): number {
  return rankValue(card.rank) * 4 + SUIT_INDEX[card.suit];
}

function decode(id: number): { rank: number; suit: number } {
  return { rank: Math.floor(id / 4), suit: id % 4 };
}

export type PostflopActionType = "check" | "bet" | "call" | "fold" | "raise";

export interface PostflopActionResult {
  action: PostflopActionType;
  sizeBB?: number;
  frequency: number;
  evBB: number;
}

export interface PostflopSolveResult {
  status: "solved";
  street: Spot["street"];
  realization: "exact" | "equity";
  iterations: number;
  exploitabilityBB: number;
  actions: PostflopActionResult[];
  handStrategy: { combo: string; inHeroRange: boolean; actions: PostflopActionResult[] } | null;
  ranges: { heroCombos: number; villainCombos: number };
  notes: string[];
}

export interface PostflopSolveArgs {
  spot: Spot;
  heroCombos: WeightedCombo[];
  villainCombos: WeightedCombo[];
  /** True when hero is first to act on the street (OOP); false if villain already checked. */
  heroActsFirst?: boolean;
  betFractions?: number[];
  raiseFractions?: number[];
  maxRaises?: number;
  iterations?: number;
  equitySamples?: number;
  maxCombos?: number;
  seed?: number;
  rake?: Rake;
}

interface PreparedCombo {
  ids: [number, number];
  weight: number;
  key: string;
}

// --- node model ----------------------------------------------------------------

type Node = DecisionNode | TerminalNode;

interface DecisionNode {
  kind: "decision";
  player: 0 | 1; // 0 = hero, 1 = villain
  id: number; // per-owner node id
  actions: Edge[];
}

interface Edge {
  action: PostflopActionType;
  sizeBB?: number;
  /** Chips the acting player adds along this edge. */
  add: number;
  child: Node;
}

type TerminalNode = { kind: "fold"; winner: 0 | 1 } | { kind: "showdown" };

interface TreeState {
  toAct: 0 | 1;
  committed: [number, number];
  stack: [number, number];
  raises: number;
  priorCheck: boolean;
}

// --- public entry --------------------------------------------------------------

export function solvePostflop(args: PostflopSolveArgs): PostflopSolveResult {
  const { spot } = args;
  if (spot.street === "preflop") throw new Error("solvePostflop is postflop only");
  if (spot.board.length < 3) throw new Error("postflop solve needs a flop or later board");

  const rng = mulberry32(args.seed ?? 0x51ed5eed);
  const maxCombos = args.maxCombos ?? 160;
  const hero = prepareCombos(args.heroCombos, spot, rng, maxCombos);
  const villain = prepareCombos(args.villainCombos, spot, rng, maxCombos);
  if (hero.length === 0 || villain.length === 0) {
    throw new Error("postflop solve needs non-empty hero and villain ranges");
  }

  const realization: "exact" | "equity" = spot.street === "river" ? "exact" : "equity";
  const equity = buildEquityMatrix(
    hero,
    villain,
    spot,
    realization,
    args.equitySamples ?? 300,
    rng,
  );

  const cfg: BuildCfg = {
    potBB: spot.potBB,
    betFractions: args.betFractions ?? [0.66],
    raiseFractions: args.raiseFractions ?? [1],
    maxRaises: args.maxRaises ?? 3,
  };
  const tables: NodeTable[] = [];
  const counts: [number, number] = [0, 0];
  const root = buildTree(
    {
      toAct: 0,
      committed: [0, spot.toCallBB],
      stack: [spot.effectiveStackBB, spot.effectiveStackBB],
      raises: spot.toCallBB > 1e-9 ? 1 : 0,
      priorCheck: spot.toCallBB <= 1e-9 && args.heroActsFirst === false,
    },
    cfg,
    tables,
    counts,
  );

  const heroStore = makeStorage(
    hero.length,
    tables.filter((t) => t.player === 0),
  );
  const villainStore = makeStorage(
    villain.length,
    tables.filter((t) => t.player === 1),
  );

  const iterations = args.iterations ?? 500;
  const board = { hero, villain, equity, potBB: spot.potBB, rake: args.rake };
  const cfrCtx: CfrCtx = { ...board, store: [heroStore, villainStore] };
  for (let it = 0; it < iterations; it++) {
    cfr(root, 0, cfrCtx, reachOf(hero), reachOf(villain), [0, 0]);
    cfr(root, 1, cfrCtx, reachOf(villain), reachOf(hero), [0, 0]);
  }

  const evalCtx: EvalCtx = {
    ...board,
    heroStrategy: averageStrategies(heroStore),
    villainStrategy: averageStrategies(villainStore),
  };

  return {
    status: "solved",
    street: spot.street,
    realization,
    iterations,
    exploitabilityBB: exploitability(root, evalCtx),
    actions: rootActionResults(root, evalCtx),
    handStrategy: heroHandStrategy(root, evalCtx, spot.heroCards),
    ranges: { heroCombos: hero.length, villainCombos: villain.length },
    notes: [
      realization === "exact"
        ? "Exact heads-up river GTO solve (full bet/raise tree)."
        : `Heads-up ${spot.street} GTO solve; remaining runout realized by equity (no future betting).`,
    ],
  };
}

// --- combo preparation + equity -----------------------------------------------

function prepareCombos(
  combos: WeightedCombo[],
  spot: Spot,
  rng: () => number,
  cap: number,
): PreparedCombo[] {
  const boardDead = new Set(spot.board.map(cardId));
  const prepared: PreparedCombo[] = [];
  for (const c of combos) {
    if (c.weight <= 0) continue;
    const a = cardId(c.cards[0]);
    const b = cardId(c.cards[1]);
    if (boardDead.has(a) || boardDead.has(b)) continue;
    prepared.push({ ids: [a, b], weight: c.weight, key: comboKey(c.cards) });
  }
  const pool = dedupe(prepared);
  if (pool.length <= cap) return normalizeWeights(pool);
  const sampled: PreparedCombo[] = [];
  while (sampled.length < cap && pool.length > 0) {
    const idx = (rng() * pool.length) | 0;
    sampled.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return normalizeWeights(sampled);
}

/** Scale combo weights to a probability distribution so CFR values are in bb. */
function normalizeWeights(combos: PreparedCombo[]): PreparedCombo[] {
  const total = combos.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return combos;
  return combos.map((c) => ({ ...c, weight: c.weight / total }));
}

function dedupe(combos: PreparedCombo[]): PreparedCombo[] {
  const byKey = new Map<string, PreparedCombo>();
  for (const c of combos) byKey.set(c.key, c);
  return [...byKey.values()];
}

function overlaps(a: PreparedCombo, b: PreparedCombo): boolean {
  return (
    a.ids[0] === b.ids[0] || a.ids[0] === b.ids[1] || a.ids[1] === b.ids[0] || a.ids[1] === b.ids[1]
  );
}

/** equity[i*V + j] = hero combo i's pot share vs villain combo j (0..1); NaN if blocked. */
function buildEquityMatrix(
  hero: PreparedCombo[],
  villain: PreparedCombo[],
  spot: Spot,
  realization: "exact" | "equity",
  samples: number,
  rng: () => number,
): Float64Array {
  const V = villain.length;
  const matrix = new Float64Array(hero.length * V);
  const boardIds = spot.board.map(cardId);

  if (realization === "exact") {
    const heroScores = hero.map((c) => evaluate7([...c.ids, ...boardIds].map(decode)));
    const villainScores = villain.map((c) => evaluate7([...c.ids, ...boardIds].map(decode)));
    for (let i = 0; i < hero.length; i++) {
      for (let j = 0; j < V; j++) {
        matrix[i * V + j] = overlaps(hero[i]!, villain[j]!)
          ? Number.NaN
          : heroScores[i]! > villainScores[j]!
            ? 1
            : heroScores[i]! < villainScores[j]!
              ? 0
              : 0.5;
      }
    }
    return matrix;
  }

  const sums = new Float64Array(hero.length * V);
  const counts = new Float64Array(hero.length * V);
  const need = 5 - spot.board.length;
  for (let s = 0; s < samples; s++) {
    const used = new Set(boardIds);
    const runout: number[] = [];
    while (runout.length < need) {
      const id = DECK_IDS[(rng() * DECK_IDS.length) | 0]!;
      if (used.has(id)) continue;
      used.add(id);
      runout.push(id);
    }
    const full = [...boardIds, ...runout];
    const heroScores = hero.map((c) =>
      runoutBlocks(c, runout) ? -1 : evaluate7([...c.ids, ...full].map(decode)),
    );
    const villainScores = villain.map((c) =>
      runoutBlocks(c, runout) ? -1 : evaluate7([...c.ids, ...full].map(decode)),
    );
    for (let i = 0; i < hero.length; i++) {
      if (heroScores[i]! < 0) continue;
      for (let j = 0; j < V; j++) {
        if (villainScores[j]! < 0 || overlaps(hero[i]!, villain[j]!)) continue;
        const idx = i * V + j;
        counts[idx]! += 1;
        sums[idx]! +=
          heroScores[i]! > villainScores[j]! ? 1 : heroScores[i]! < villainScores[j]! ? 0 : 0.5;
      }
    }
  }
  for (let i = 0; i < hero.length; i++) {
    for (let j = 0; j < V; j++) {
      const idx = i * V + j;
      matrix[idx] = overlaps(hero[i]!, villain[j]!)
        ? Number.NaN
        : counts[idx]! > 0
          ? sums[idx]! / counts[idx]!
          : 0.5;
    }
  }
  return matrix;
}

function runoutBlocks(c: PreparedCombo, runout: number[]): boolean {
  return runout.includes(c.ids[0]) || runout.includes(c.ids[1]);
}

// --- tree construction ---------------------------------------------------------

interface NodeTable {
  player: 0 | 1;
  id: number;
  actionCount: number;
}

interface BuildCfg {
  potBB: number;
  betFractions: number[];
  raiseFractions: number[];
  maxRaises: number;
}

function buildTree(
  state: TreeState,
  cfg: BuildCfg,
  tables: NodeTable[],
  counts: [number, number],
): Node {
  const { toAct } = state;
  const opp = (1 - toAct) as 0 | 1;
  const facing = Math.max(0, state.committed[opp] - state.committed[toAct]);
  const potNow = cfg.potBB + state.committed[0] + state.committed[1];
  const edges: Edge[] = [];

  if (facing <= 1e-9) {
    const checkChild: Node = state.priorCheck
      ? { kind: "showdown" }
      : buildTree({ ...state, toAct: opp, priorCheck: true }, cfg, tables, counts);
    edges.push({ action: "check", add: 0, child: checkChild });

    for (const frac of cfg.betFractions) {
      const size = Math.min(state.stack[toAct], roundChips(frac * potNow));
      if (size <= 1e-9) continue;
      const committed: [number, number] = [...state.committed];
      committed[toAct] += size;
      const stack: [number, number] = [...state.stack];
      stack[toAct] -= size;
      edges.push({
        action: "bet",
        sizeBB: size,
        add: size,
        child: buildTree(
          { toAct: opp, committed, stack, raises: state.raises + 1, priorCheck: false },
          cfg,
          tables,
          counts,
        ),
      });
    }
  } else {
    edges.push({ action: "fold", add: 0, child: { kind: "fold", winner: opp } });
    const callAmount = Math.min(facing, state.stack[toAct]);
    edges.push({ action: "call", add: callAmount, child: { kind: "showdown" } });

    if (state.raises < cfg.maxRaises) {
      for (const frac of cfg.raiseFractions) {
        const extra = roundChips(frac * (potNow + facing));
        const total = Math.min(state.stack[toAct], facing + extra);
        if (total <= facing + 1e-9) continue;
        const committed: [number, number] = [...state.committed];
        committed[toAct] += total;
        const stack: [number, number] = [...state.stack];
        stack[toAct] -= total;
        edges.push({
          action: "raise",
          sizeBB: committed[toAct],
          add: total,
          child: buildTree(
            { toAct: opp, committed, stack, raises: state.raises + 1, priorCheck: false },
            cfg,
            tables,
            counts,
          ),
        });
      }
    }
  }

  const id = counts[toAct];
  counts[toAct] += 1;
  tables.push({ player: toAct, id, actionCount: edges.length });
  return { kind: "decision", player: toAct, id, actions: edges };
}

function roundChips(x: number): number {
  return Math.round(x * 100) / 100;
}

// --- storage -------------------------------------------------------------------

interface PlayerStore {
  regret: Float64Array[];
  strategySum: Float64Array[];
  offsets: number[];
  actionCounts: number[];
}

function makeStorage(combos: number, tables: NodeTable[]): PlayerStore {
  const offsets: number[] = [];
  const actionCounts: number[] = [];
  let total = 0;
  for (const t of [...tables].sort((a, b) => a.id - b.id)) {
    offsets[t.id] = total;
    actionCounts[t.id] = t.actionCount;
    total += t.actionCount;
  }
  const regret: Float64Array[] = [];
  const strategySum: Float64Array[] = [];
  for (let i = 0; i < combos; i++) {
    regret.push(new Float64Array(total));
    strategySum.push(new Float64Array(total));
  }
  return { regret, strategySum, offsets, actionCounts };
}

// --- CFR -----------------------------------------------------------------------

interface BoardCtx {
  hero: PreparedCombo[];
  villain: PreparedCombo[];
  equity: Float64Array;
  potBB: number;
  rake?: Rake;
}

interface CfrCtx extends BoardCtx {
  store: [PlayerStore, PlayerStore];
}

function reachOf(combos: PreparedCombo[]): Float64Array {
  return Float64Array.from(combos, (c) => c.weight);
}

function regretStrategy(store: PlayerStore, node: DecisionNode, combo: number): Float64Array {
  const base = store.offsets[node.id]!;
  const n = node.actions.length;
  const out = new Float64Array(n);
  let sum = 0;
  for (let a = 0; a < n; a++) {
    const r = store.regret[combo]![base + a]!;
    const v = r > 0 ? r : 0;
    out[a] = v;
    sum += v;
  }
  if (sum > 0) for (let a = 0; a < n; a++) out[a]! /= sum;
  else out.fill(1 / n);
  return out;
}

function cfr(
  node: Node,
  traverser: 0 | 1,
  ctx: CfrCtx,
  reachT: Float64Array,
  reachO: Float64Array,
  invested: [number, number],
): Float64Array {
  if (node.kind !== "decision") {
    return terminalValue(node, traverser, ctx, reachO, invested);
  }

  const owner = node.player;
  const ownerCombos = owner === 0 ? ctx.hero : ctx.villain;
  const ownerStore = ctx.store[owner];
  const tCombos = traverser === 0 ? ctx.hero : ctx.villain;
  const u = new Float64Array(tCombos.length);
  const strategies = ownerCombos.map((_, k) => regretStrategy(ownerStore, node, k));

  if (owner === traverser) {
    const childValues: Float64Array[] = [];
    for (let a = 0; a < node.actions.length; a++) {
      const edge = node.actions[a]!;
      const reachChild = new Float64Array(reachT.length);
      for (let i = 0; i < reachT.length; i++) reachChild[i] = reachT[i]! * strategies[i]![a]!;
      const inv: [number, number] = [invested[0], invested[1]];
      inv[owner] += edge.add;
      childValues.push(cfr(edge.child, traverser, ctx, reachChild, reachO, inv));
    }
    const base = ownerStore.offsets[node.id]!;
    for (let i = 0; i < u.length; i++) {
      let ui = 0;
      for (let a = 0; a < node.actions.length; a++) ui += strategies[i]![a]! * childValues[a]![i]!;
      u[i] = ui;
      for (let a = 0; a < node.actions.length; a++) {
        ownerStore.regret[i]![base + a]! += childValues[a]![i]! - ui;
        ownerStore.strategySum[i]![base + a]! += reachT[i]! * strategies[i]![a]!;
      }
    }
    return u;
  }

  for (let a = 0; a < node.actions.length; a++) {
    const edge = node.actions[a]!;
    const reachChild = new Float64Array(reachO.length);
    for (let j = 0; j < reachO.length; j++) reachChild[j] = reachO[j]! * strategies[j]![a]!;
    const inv: [number, number] = [invested[0], invested[1]];
    inv[owner] += edge.add;
    const child = cfr(edge.child, traverser, ctx, reachT, reachChild, inv);
    for (let i = 0; i < u.length; i++) u[i]! += child[i]!;
  }
  return u;
}

function terminalValue(
  node: TerminalNode,
  traverser: 0 | 1,
  ctx: BoardCtx,
  reachO: Float64Array,
  invested: [number, number],
): Float64Array {
  const tCombos = traverser === 0 ? ctx.hero : ctx.villain;
  const oCombos = traverser === 0 ? ctx.villain : ctx.hero;
  const u = new Float64Array(tCombos.length);
  const potTotal = ctx.potBB + invested[0] + invested[1];
  const rakedPot = afterRake(potTotal, ctx.rake);
  const putInT = invested[traverser];
  const V = ctx.villain.length;

  for (let i = 0; i < tCombos.length; i++) {
    let value = 0;
    for (let j = 0; j < oCombos.length; j++) {
      const r = reachO[j]!;
      if (r === 0 || overlaps(tCombos[i]!, oCombos[j]!)) continue;
      if (node.kind === "fold") {
        value += r * (node.winner === traverser ? rakedPot - putInT : -putInT);
      } else {
        const heroIdx = traverser === 0 ? i : j;
        const villIdx = traverser === 0 ? j : i;
        const share = ctx.equity[heroIdx * V + villIdx]!;
        if (Number.isNaN(share)) continue;
        const traverserShare = traverser === 0 ? share : 1 - share;
        value += r * (traverserShare * rakedPot - putInT);
      }
    }
    u[i] = value;
  }
  return u;
}

// --- extraction ----------------------------------------------------------------

interface PlayerAverage {
  strategy: Float64Array[];
  offsets: number[];
}

function averageStrategies(store: PlayerStore): PlayerAverage {
  const strategy: Float64Array[] = [];
  for (let i = 0; i < store.strategySum.length; i++) {
    const src = store.strategySum[i]!;
    const out = new Float64Array(src.length);
    for (let nodeId = 0; nodeId < store.offsets.length; nodeId++) {
      const base = store.offsets[nodeId]!;
      const n = store.actionCounts[nodeId]!;
      let sum = 0;
      for (let a = 0; a < n; a++) sum += src[base + a]!;
      for (let a = 0; a < n; a++) out[base + a] = sum > 0 ? src[base + a]! / sum : 1 / n;
    }
    strategy.push(out);
  }
  return { strategy, offsets: store.offsets };
}

interface EvalCtx extends BoardCtx {
  heroStrategy: PlayerAverage;
  villainStrategy: PlayerAverage;
}

/** Value vector for `player`'s combos under both average strategies. */
function evalNode(
  node: Node,
  player: 0 | 1,
  ctx: EvalCtx,
  reachO: Float64Array,
  invested: [number, number],
): Float64Array {
  if (node.kind !== "decision") return terminalValue(node, player, ctx, reachO, invested);

  const owner = node.player;
  const avg = owner === 0 ? ctx.heroStrategy : ctx.villainStrategy;
  const pCombos = player === 0 ? ctx.hero : ctx.villain;
  const u = new Float64Array(pCombos.length);
  const base = avg.offsets[node.id]!;

  if (owner === player) {
    for (let a = 0; a < node.actions.length; a++) {
      const edge = node.actions[a]!;
      const inv: [number, number] = [invested[0], invested[1]];
      inv[owner] += edge.add;
      const child = evalNode(edge.child, player, ctx, reachO, inv);
      for (let i = 0; i < u.length; i++) u[i]! += avg.strategy[i]![base + a]! * child[i]!;
    }
    return u;
  }

  for (let a = 0; a < node.actions.length; a++) {
    const edge = node.actions[a]!;
    const reachChild = new Float64Array(reachO.length);
    for (let j = 0; j < reachO.length; j++)
      reachChild[j] = reachO[j]! * avg.strategy[j]![base + a]!;
    const inv: [number, number] = [invested[0], invested[1]];
    inv[owner] += edge.add;
    const child = evalNode(edge.child, player, ctx, reachChild, inv);
    for (let i = 0; i < u.length; i++) u[i]! += child[i]!;
  }
  return u;
}

function rootActionResults(root: Node, ctx: EvalCtx): PostflopActionResult[] {
  if (root.kind !== "decision") return [];
  const weights = ctx.hero.map((c) => c.weight);
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  const reachV = reachOf(ctx.villain);
  const base = ctx.heroStrategy.offsets[root.id]!;

  return root.actions.map((edge, a) => {
    const childVal = evalNode(edge.child, 0, ctx, reachV, [edge.add, 0]);
    let freqNum = 0;
    let evNum = 0;
    for (let i = 0; i < ctx.hero.length; i++) {
      const f = ctx.heroStrategy.strategy[i]![base + a]!;
      freqNum += weights[i]! * f;
      evNum += weights[i]! * f * childVal[i]!;
    }
    return {
      action: edge.action,
      sizeBB: edge.sizeBB,
      frequency: freqNum / totalWeight,
      evBB: freqNum > 1e-9 ? evNum / freqNum : weightedMean(childVal, weights),
    };
  });
}

function weightedMean(values: Float64Array, weights: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    num += weights[i]! * values[i]!;
    den += weights[i]!;
  }
  return den > 0 ? num / den : 0;
}

function heroHandStrategy(
  root: Node,
  ctx: EvalCtx,
  heroCards: [Card, Card],
): PostflopSolveResult["handStrategy"] {
  if (root.kind !== "decision") return null;
  const key = comboKey(heroCards);
  const idx = ctx.hero.findIndex((c) => c.key === key);
  if (idx === -1) return { combo: key, inHeroRange: false, actions: [] };

  const reachV = reachOf(ctx.villain);
  const base = ctx.heroStrategy.offsets[root.id]!;
  const actions = root.actions.map((edge, a) => {
    const childVal = evalNode(edge.child, 0, ctx, reachV, [edge.add, 0]);
    return {
      action: edge.action,
      sizeBB: edge.sizeBB,
      frequency: ctx.heroStrategy.strategy[idx]![base + a]!,
      evBB: childVal[idx]!,
    };
  });
  return { combo: key, inHeroRange: true, actions };
}

/** Best-response value (bb) for `player` vs the other's average strategy. */
function bestResponse(
  node: Node,
  player: 0 | 1,
  ctx: EvalCtx,
  reachO: Float64Array,
  invested: [number, number],
): Float64Array {
  if (node.kind !== "decision") return terminalValue(node, player, ctx, reachO, invested);
  const pCombos = player === 0 ? ctx.hero : ctx.villain;
  const u = new Float64Array(pCombos.length);

  if (node.player === player) {
    const childVals = node.actions.map((edge) => {
      const inv: [number, number] = [invested[0], invested[1]];
      inv[node.player] += edge.add;
      return bestResponse(edge.child, player, ctx, reachO, inv);
    });
    for (let i = 0; i < u.length; i++) {
      let best = Number.NEGATIVE_INFINITY;
      for (const cv of childVals) best = Math.max(best, cv[i]!);
      u[i] = best;
    }
    return u;
  }

  const avg = node.player === 0 ? ctx.heroStrategy : ctx.villainStrategy;
  const base = avg.offsets[node.id]!;
  for (let a = 0; a < node.actions.length; a++) {
    const edge = node.actions[a]!;
    const reachChild = new Float64Array(reachO.length);
    for (let j = 0; j < reachO.length; j++)
      reachChild[j] = reachO[j]! * avg.strategy[j]![base + a]!;
    const inv: [number, number] = [invested[0], invested[1]];
    inv[node.player] += edge.add;
    const child = bestResponse(edge.child, player, ctx, reachChild, inv);
    for (let i = 0; i < u.length; i++) u[i]! += child[i]!;
  }
  return u;
}

/**
 * NashConv-style exploitability: each player's gain from switching to a best
 * response against the other's average strategy. Uses the achieved strategy
 * values as the baseline, so the constant-sum dead-money offset and blocker mass
 * cancel out. → 0 at equilibrium, in bb.
 */
function exploitability(root: Node, ctx: EvalCtx): number {
  const heroW = ctx.hero.map((c) => c.weight);
  const villW = ctx.villain.map((c) => c.weight);
  const v0 = weightedMean(evalNode(root, 0, ctx, reachOf(ctx.villain), [0, 0]), heroW);
  const v1 = weightedMean(evalNode(root, 1, ctx, reachOf(ctx.hero), [0, 0]), villW);
  const br0 = weightedMean(bestResponse(root, 0, ctx, reachOf(ctx.villain), [0, 0]), heroW);
  const br1 = weightedMean(bestResponse(root, 1, ctx, reachOf(ctx.hero), [0, 0]), villW);
  return Math.max(0, (br0 - v0 + (br1 - v1)) / 2);
}

function comboKey([a, b]: [Card, Card]): string {
  return [formatCard(a), formatCard(b)].sort().join("");
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
