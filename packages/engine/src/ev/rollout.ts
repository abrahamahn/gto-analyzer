import { type ActionType, type Card, Rank, type Spot, Suit } from "@poker/shared";
import type { WeightedCombo } from "../combos.js";
import { evaluate7 } from "../equity.js";
import { rankValue } from "../handClass.js";
import { MadeHand, madeHand } from "../ranges/strength.js";

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};

interface Enc {
  rank: number;
  suit: number;
}

function enc(card: Card): Enc {
  return { rank: rankValue(card.rank), suit: SUIT_INDEX[card.suit] };
}

function cardId(c: Enc): number {
  return c.rank * 4 + c.suit;
}

const DECK: Enc[] = (() => {
  const out: Enc[] = [];
  for (const r of Object.values(Rank)) {
    for (const s of Object.values(Suit)) out.push({ rank: rankValue(r), suit: SUIT_INDEX[s] });
  }
  return out;
})();

/** A candidate action to price, with its sizing in big blinds (for bet/raise). */
export interface Candidate {
  type: ActionType;
  sizeBB?: number;
}

/** Expected value of one candidate action, in big blinds, with Monte Carlo error. */
export interface ActionEV {
  type: ActionType;
  sizeBB?: number;
  evBB: number;
  stderrBB: number;
  /** For aggressive actions: fraction of villain combos that fold to it. */
  villainFoldPct?: number;
}

export interface RolloutResult {
  actions: ActionEV[];
  iterations: number;
  /** "modeled" heads-up, "approximate" multiway (independent villain responses). */
  confidence: "modeled" | "approximate";
}

/** House rake: a fraction of a flop-or-later pot, capped in big blinds. */
export interface Rake {
  percent: number;
  capBB: number;
}

/** Hero's net collection from a won pot after rake (only pots that saw a flop are raked). */
function afterRake(pot: number, rake: Rake | undefined, raked: boolean): number {
  if (!rake || rake.percent <= 0 || !raked) return pot;
  const taken = Math.min(
    rake.percent * pot,
    rake.capBB > 0 ? rake.capBB : Number.POSITIVE_INFINITY,
  );
  return pot - taken;
}

interface PreparedVillain {
  combos: Array<{ ids: [number, number]; cards: [Card, Card]; cumulative: number }>;
  total: number;
}

function prepareVillain(combos: WeightedCombo[]): PreparedVillain {
  let total = 0;
  const prepared = combos
    .filter((c) => c.weight > 0)
    .map((c) => {
      total += c.weight;
      return {
        ids: [cardId(enc(c.cards[0])), cardId(enc(c.cards[1]))] as [number, number],
        cards: c.cards,
        cumulative: total,
      };
    });
  return { combos: prepared, total };
}

function sampleVillain(v: PreparedVillain, taken: Set<number>, rng: () => number) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const roll = rng() * v.total;
    let lo = 0;
    let hi = v.combos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (roll <= v.combos[mid]!.cumulative) hi = mid;
      else lo = mid + 1;
    }
    const combo = v.combos[lo];
    if (combo && !taken.has(combo.ids[0]) && !taken.has(combo.ids[1])) return combo;
  }
  return undefined;
}

/** Does a villain holding continue against a bet of `betBB` into pot `potBB`? */
function villainContinues(
  hole: [Card, Card],
  board: Card[],
  betBB: number,
  potBB: number,
  rng: () => number,
): boolean {
  const ratio = potBB > 0 ? betBB / potBB : 1;
  const bucket = madeHand(hole, board);
  switch (bucket) {
    case MadeHand.Nuts:
    case MadeHand.TwoPairPlus:
    case MadeHand.TopPairOrSecond:
      return true;
    case MadeHand.WeakPair:
      return ratio <= 0.6;
    case MadeHand.StrongDraw:
      return ratio <= 1.0;
    case MadeHand.WeakDraw:
      return ratio <= 0.4;
    default:
      return rng() < 0.05; // occasional bluff-catch / float
  }
}

/**
 * Price candidate actions at a hero decision by Monte Carlo rollout against the
 * modeled villain ranges. Uses common random numbers — one sampled villain
 * holding and 5-card runout per iteration is scored against every candidate — so
 * EV *differences* (and therefore EV loss) are low-variance.
 *
 * Continuation is simplified: after the priced action, remaining streets are
 * checked down to showdown (no further betting). This captures fold equity and
 * showdown equity — the dominant terms — and is intentionally conservative about
 * future value. Heads-up is "modeled"; multiway responses are independent per
 * villain and labeled "approximate".
 */
export function rolloutSpot(args: {
  spot: Spot;
  /** Concrete weighted combos for each live villain (from modelVillainRange). */
  villains: WeightedCombo[][];
  candidates: Candidate[];
  iterations?: number;
  seed?: number;
  rake?: Rake;
}): RolloutResult {
  const { spot } = args;
  const iterations = args.iterations ?? 20000;
  const rng = mulberry32(args.seed ?? 0x9e3779b9);
  const villains = args.villains.map(prepareVillain).filter((v) => v.combos.length > 0);
  const heroEnc = spot.heroCards.map(enc);
  const boardEnc = spot.board.map(enc);
  const heroIds = heroEnc.map(cardId);
  const potBB = spot.potBB;
  const toCallBB = spot.toCallBB;

  // Accumulators per candidate: sum and sum-of-squares for stderr.
  const sums = args.candidates.map(() => 0);
  const sqs = args.candidates.map(() => 0);
  const foldCounts = args.candidates.map(() => 0);
  const foldDenoms = args.candidates.map(() => 0);
  let counted = 0;

  const used = new Set<number>([...heroIds, ...boardEnc.map(cardId)]);

  for (let it = 0; it < iterations; it++) {
    const taken = new Set(used);
    const villainHoles: Array<{ cards: [Card, Card]; enc: [Enc, Enc] }> = [];
    let ok = true;
    for (const v of villains) {
      const combo = sampleVillain(v, taken, rng);
      if (!combo) {
        ok = false;
        break;
      }
      taken.add(combo.ids[0]);
      taken.add(combo.ids[1]);
      villainHoles.push({ cards: combo.cards, enc: [enc(combo.cards[0]), enc(combo.cards[1])] });
    }
    if (!ok || villainHoles.length === 0) continue;

    // Complete the board once (common random numbers across candidates).
    const runout = [...boardEnc];
    while (runout.length < 5) {
      const c = DECK[(rng() * DECK.length) | 0]!;
      const id = cardId(c);
      if (taken.has(id)) continue;
      taken.add(id);
      runout.push(c);
    }

    const heroScore = evaluate7([...heroEnc, ...runout]);
    const villainScores = villainHoles.map((v) => evaluate7([...v.enc, ...runout]));

    // Hero's showdown share vs ALL villains (split on ties with those tied).
    const bestVillain = Math.max(...villainScores);
    const shareAll =
      heroScore > bestVillain
        ? 1
        : heroScore < bestVillain
          ? 0
          : 1 / (1 + villainScores.filter((s) => s === heroScore).length);

    for (let ci = 0; ci < args.candidates.length; ci++) {
      const cand = args.candidates[ci]!;
      const outcome = priceCandidate(cand, {
        potBB,
        toCallBB,
        shareAll,
        villainHoles,
        villainScores,
        heroScore,
        board: spot.board,
        rng,
        rake: args.rake,
        preflop: spot.street === "preflop",
      });
      sums[ci]! += outcome.ev;
      sqs[ci]! += outcome.ev * outcome.ev;
      if (outcome.foldDenom) {
        foldDenoms[ci]! += outcome.foldDenom;
        foldCounts[ci]! += outcome.foldNum;
      }
    }
    counted++;
  }

  const actions: ActionEV[] = args.candidates.map((cand, ci) => {
    const mean = counted > 0 ? sums[ci]! / counted : 0;
    const variance = counted > 1 ? Math.max(0, sqs[ci]! / counted - mean * mean) : 0;
    const stderr = counted > 0 ? Math.sqrt(variance / counted) : 0;
    const ev: ActionEV = { type: cand.type, evBB: mean, stderrBB: stderr };
    if (cand.sizeBB !== undefined) ev.sizeBB = cand.sizeBB;
    if (foldDenoms[ci]! > 0) ev.villainFoldPct = foldCounts[ci]! / foldDenoms[ci]!;
    return ev;
  });

  return {
    actions,
    iterations: counted,
    confidence: villains.length > 1 ? "approximate" : "modeled",
  };
}

interface PriceCtx {
  potBB: number;
  toCallBB: number;
  shareAll: number;
  villainHoles: Array<{ cards: [Card, Card]; enc: [Enc, Enc] }>;
  villainScores: number[];
  heroScore: number;
  board: Card[];
  rng: () => number;
  rake: Rake | undefined;
  preflop: boolean;
}

/** Net big blinds for a single candidate action on one sampled rollout. */
function priceCandidate(
  cand: Candidate,
  ctx: PriceCtx,
): { ev: number; foldNum: number; foldDenom: number } {
  const { potBB, toCallBB, shareAll, rake } = ctx;

  if (cand.type === "fold") return { ev: 0, foldNum: 0, foldDenom: 0 };

  // Passive: check (toCall 0) or call (toCall > 0). Check down to showdown — a
  // flop is always seen, so the pot is raked.
  if (cand.type === "check" || cand.type === "call") {
    const invest = cand.type === "call" ? toCallBB : 0;
    const finalPot = potBB + invest;
    return { ev: shareAll * afterRake(finalPot, rake, true) - invest, foldNum: 0, foldDenom: 0 };
  }

  // Aggressive: bet / raise / all-in. Each villain independently folds or calls.
  const sizeBB = cand.sizeBB ?? Math.max(toCallBB * 3, potBB * 0.66);
  const invest = toCallBB + sizeBB;
  const continues = ctx.villainHoles.map((v) =>
    villainContinues(v.cards, ctx.board, sizeBB, potBB, ctx.rng),
  );
  const foldDenom = ctx.villainHoles.length;
  const foldNum = continues.filter((c) => !c).length;
  const callers = foldDenom - foldNum;

  if (callers === 0) {
    // Everyone folds: hero wins the existing pot (raked only if a flop was seen).
    return { ev: afterRake(potBB, rake, !ctx.preflop), foldNum, foldDenom };
  }

  const finalPot = potBB + sizeBB * (callers + 1);
  const callerScores = ctx.villainScores.filter((_, i) => continues[i]);
  const bestCaller = Math.max(...callerScores);
  const share =
    ctx.heroScore > bestCaller
      ? 1
      : ctx.heroScore < bestCaller
        ? 0
        : 1 / (1 + callerScores.filter((s) => s === ctx.heroScore).length);
  return { ev: share * afterRake(finalPot, rake, true) - invest, foldNum, foldDenom };
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
