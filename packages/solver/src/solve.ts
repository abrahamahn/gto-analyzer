import { compileRange, evaluate7, rankValue } from "@poker/engine";
import { type Card, Rank, type Spot, Suit, formatCard } from "@poker/shared";
import { solveRequestHash } from "./hash.js";
import {
  type NormalizedSolveConfig,
  type SolveActionResult,
  type SolveRequest,
  type SolveResult,
  normalizeSolveConfig,
} from "./types.js";

interface Encoded {
  rank: number;
  suit: number;
}

interface RangeCombo {
  cards: [Card, Card];
  key: string;
  ids: [number, number];
  weight: number;
  score: number;
}

interface CfrNode {
  regrets: [number, number];
  strategySum: [number, number];
  reach: number;
}

interface StrategyValues {
  actions: SolveActionResult[];
  exploitabilityBB: number;
  currentEvBB: number;
  legalPairs: number;
}

const SUIT_INDEX: Record<Suit, number> = {
  [Suit.Clubs]: 0,
  [Suit.Diamonds]: 1,
  [Suit.Hearts]: 2,
  [Suit.Spades]: 3,
};

const SUITS: readonly Suit[] = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];

export async function solveSpot(req: SolveRequest): Promise<SolveResult> {
  assertSupportedRiverNode(req.spot);
  const config = normalizeSolveConfig(req);
  const boardBlockers = new Set(req.spot.board.map(formatCard));
  const heroCombos = buildRangeCombos(req.heroRange, req.spot.board, boardBlockers);
  const villainCombos = buildRangeCombos(req.villainRange, req.spot.board, boardBlockers);

  if (heroCombos.length === 0) throw new Error("hero range has no unblocked river combos");
  if (villainCombos.length === 0) throw new Error("villain range has no unblocked river combos");

  const legalPairs = countLegalPairs(heroCombos, villainCombos);
  if (legalPairs === 0)
    throw new Error("hero and villain ranges have no legal non-overlapping pairs");

  const heroNodes = heroCombos.map(createNode);
  const villainNodes = villainCombos.map(createNode);
  runChanceSampledCfr({
    spot: req.spot,
    config,
    heroCombos,
    villainCombos,
    heroNodes,
    villainNodes,
  });

  const heroStrategy = heroNodes.map(averageStrategy);
  const villainStrategy = villainNodes.map(averageStrategy);
  const values = computeStrategyValues({
    spot: req.spot,
    config,
    heroCombos,
    villainCombos,
    heroStrategy,
    villainStrategy,
  });
  const handStrategy = computeHandStrategy({
    spot: req.spot,
    config,
    heroCombos,
    villainCombos,
    heroStrategy,
    villainStrategy,
  });
  const notes = [
    "Scoped solver: heads-up river, one fixed hero bet size, villain fold/call response, no raises.",
    "This is a local CFR solve for the selected node, not a full GTO database or full postflop tree.",
  ];
  if (config.betWasCapped) {
    notes.push(
      `Requested bet ${formatBB(config.rawBetSizeBB)}bb was capped to effective stack ${formatBB(
        config.betSizeBB,
      )}bb.`,
    );
  }
  if (handStrategy && !handStrategy.inHeroRange) {
    notes.push("The exact hero hand is not inside the selected hero range.");
  }

  return {
    spotHash: solveRequestHash(req),
    source: "river-fixed-bet-cfr",
    mode: "heads-up-river-fixed-bet",
    status: "solved",
    iterations: config.iterations,
    exploitabilityBB: values.exploitabilityBB,
    actions: values.actions,
    handStrategy,
    ranges: {
      heroCombos: heroCombos.length,
      villainCombos: villainCombos.length,
      legalPairs: values.legalPairs,
    },
    tree: {
      street: "river",
      betSizeBB: config.betSizeBB,
      actions: ["check", "bet"],
      responseActions: ["fold", "call"],
    },
    notes,
  };
}

function assertSupportedRiverNode(spot: Spot): void {
  if (spot.street !== "river") {
    throw new Error("river fixed-bet CFR currently supports river spots only");
  }
  if (spot.board.length !== 5) {
    throw new Error("river fixed-bet CFR requires exactly five board cards");
  }
  if (spot.toCallBB > 0) {
    throw new Error(
      "river fixed-bet CFR currently supports hero check/bet nodes, not facing a bet",
    );
  }
}

function runChanceSampledCfr(args: {
  spot: Spot;
  config: NormalizedSolveConfig;
  heroCombos: RangeCombo[];
  villainCombos: RangeCombo[];
  heroNodes: CfrNode[];
  villainNodes: CfrNode[];
}): void {
  const rng = mulberry32(args.config.seed);
  const heroSampler = makeSampler(args.heroCombos);
  const villainSampler = makeSampler(args.villainCombos);

  for (let i = 0; i < args.config.iterations; i++) {
    const pair = sampleLegalPair(
      args.heroCombos,
      args.villainCombos,
      heroSampler,
      villainSampler,
      rng,
    );
    const heroCombo = args.heroCombos[pair.heroIndex];
    const villainCombo = args.villainCombos[pair.villainIndex];
    const heroNode = args.heroNodes[pair.heroIndex];
    const villainNode = args.villainNodes[pair.villainIndex];
    if (!heroCombo || !villainCombo || !heroNode || !villainNode) continue;

    const heroStrategy = regretMatching(heroNode);
    const villainStrategy = regretMatching(villainNode);
    const share = showdownShare(heroCombo, villainCombo);
    const checkEv = share * args.spot.potBB;
    const betFoldEv = args.spot.potBB;
    const betCallEv = share * (args.spot.potBB + args.config.betSizeBB * 2) - args.config.betSizeBB;
    const betEv = villainStrategy[0] * betFoldEv + villainStrategy[1] * betCallEv;
    const heroNodeEv = heroStrategy[0] * checkEv + heroStrategy[1] * betEv;

    heroNode.regrets[0] += checkEv - heroNodeEv;
    heroNode.regrets[1] += betEv - heroNodeEv;
    heroNode.strategySum[0] += heroStrategy[0];
    heroNode.strategySum[1] += heroStrategy[1];
    heroNode.reach += 1;

    const villainFoldEv = -betFoldEv;
    const villainCallEv = -betCallEv;
    const villainNodeEv = villainStrategy[0] * villainFoldEv + villainStrategy[1] * villainCallEv;
    const betReach = heroStrategy[1];
    villainNode.regrets[0] += betReach * (villainFoldEv - villainNodeEv);
    villainNode.regrets[1] += betReach * (villainCallEv - villainNodeEv);
    villainNode.strategySum[0] += betReach * villainStrategy[0];
    villainNode.strategySum[1] += betReach * villainStrategy[1];
    villainNode.reach += betReach;
  }
}

function computeStrategyValues(args: {
  spot: Spot;
  config: NormalizedSolveConfig;
  heroCombos: RangeCombo[];
  villainCombos: RangeCombo[];
  heroStrategy: Array<[number, number]>;
  villainStrategy: Array<[number, number]>;
}): StrategyValues {
  let pairWeight = 0;
  let legalPairs = 0;
  let checkNumerator = 0;
  let betNumerator = 0;
  let currentNumerator = 0;
  let heroFrequencyWeight = 0;
  let checkFrequencyNumerator = 0;
  let betFrequencyNumerator = 0;
  let heroBestResponseNumerator = 0;

  const villainBestResponses = args.villainCombos.map((villainCombo) => {
    let callNumerator = 0;
    let betReachWeight = 0;
    for (let heroIndex = 0; heroIndex < args.heroCombos.length; heroIndex++) {
      const heroCombo = args.heroCombos[heroIndex];
      const strategy = args.heroStrategy[heroIndex];
      if (!heroCombo || !strategy || overlaps(heroCombo, villainCombo)) continue;
      const weight = heroCombo.weight * strategy[1];
      callNumerator += weight * betCallEv(args.spot, args.config, heroCombo, villainCombo);
      betReachWeight += weight;
    }
    if (betReachWeight <= 0) return "fold" as const;
    return args.spot.potBB <= callNumerator / betReachWeight ? "fold" : "call";
  });

  let villainBestResponseNumerator = 0;

  for (let heroIndex = 0; heroIndex < args.heroCombos.length; heroIndex++) {
    const heroCombo = args.heroCombos[heroIndex];
    const heroActions = args.heroStrategy[heroIndex];
    if (!heroCombo || !heroActions) continue;

    let villainWeight = 0;
    let heroCheckEvNumerator = 0;
    let heroBetEvNumerator = 0;

    for (let villainIndex = 0; villainIndex < args.villainCombos.length; villainIndex++) {
      const villainCombo = args.villainCombos[villainIndex];
      const villainActions = args.villainStrategy[villainIndex];
      if (!villainCombo || !villainActions || overlaps(heroCombo, villainCombo)) continue;

      legalPairs += 1;
      const weight = heroCombo.weight * villainCombo.weight;
      const checkEv = showdownEv(args.spot, heroCombo, villainCombo);
      const betEv =
        villainActions[0] * args.spot.potBB +
        villainActions[1] * betCallEv(args.spot, args.config, heroCombo, villainCombo);
      const currentEv = heroActions[0] * checkEv + heroActions[1] * betEv;
      const villainBestResponseAction = villainBestResponses[villainIndex] ?? "fold";
      const betEvVsVillainBr =
        villainBestResponseAction === "fold"
          ? args.spot.potBB
          : betCallEv(args.spot, args.config, heroCombo, villainCombo);

      pairWeight += weight;
      checkNumerator += weight * checkEv;
      betNumerator += weight * betEv;
      currentNumerator += weight * currentEv;
      villainBestResponseNumerator +=
        weight * (heroActions[0] * checkEv + heroActions[1] * betEvVsVillainBr);
      villainWeight += villainCombo.weight;
      heroCheckEvNumerator += villainCombo.weight * checkEv;
      heroBetEvNumerator += villainCombo.weight * betEv;
    }

    if (villainWeight > 0) {
      const strategyWeight = heroCombo.weight * villainWeight;
      const checkEv = heroCheckEvNumerator / villainWeight;
      const betEv = heroBetEvNumerator / villainWeight;
      heroBestResponseNumerator += strategyWeight * Math.max(checkEv, betEv);
      heroFrequencyWeight += strategyWeight;
      checkFrequencyNumerator += strategyWeight * heroActions[0];
      betFrequencyNumerator += strategyWeight * heroActions[1];
    }
  }

  if (pairWeight <= 0 || heroFrequencyWeight <= 0) {
    throw new Error("river fixed-bet CFR could not evaluate legal range pairs");
  }

  const currentEvBB = currentNumerator / pairWeight;
  const heroBestResponseEv = heroBestResponseNumerator / heroFrequencyWeight;
  const villainBestResponseEv = villainBestResponseNumerator / pairWeight;
  const exploitabilityBB = Math.max(0, (heroBestResponseEv - villainBestResponseEv) / 2);

  return {
    currentEvBB,
    exploitabilityBB,
    legalPairs,
    actions: [
      {
        action: "check",
        frequency: checkFrequencyNumerator / heroFrequencyWeight,
        evBB: checkNumerator / pairWeight,
      },
      {
        action: "bet",
        sizeBB: args.config.betSizeBB,
        frequency: betFrequencyNumerator / heroFrequencyWeight,
        evBB: betNumerator / pairWeight,
      },
    ],
  };
}

function computeHandStrategy(args: {
  spot: Spot;
  config: NormalizedSolveConfig;
  heroCombos: RangeCombo[];
  villainCombos: RangeCombo[];
  heroStrategy: Array<[number, number]>;
  villainStrategy: Array<[number, number]>;
}): SolveResult["handStrategy"] {
  const key = comboKey(args.spot.heroCards);
  const heroIndex = args.heroCombos.findIndex((combo) => combo.key === key);
  if (heroIndex === -1) return { combo: key, inHeroRange: false, actions: [] };

  const heroCombo = args.heroCombos[heroIndex];
  const strategy = args.heroStrategy[heroIndex];
  if (!heroCombo || !strategy) return { combo: key, inHeroRange: false, actions: [] };

  let villainWeight = 0;
  let checkNumerator = 0;
  let betNumerator = 0;
  for (let villainIndex = 0; villainIndex < args.villainCombos.length; villainIndex++) {
    const villainCombo = args.villainCombos[villainIndex];
    const villainActions = args.villainStrategy[villainIndex];
    if (!villainCombo || !villainActions || overlaps(heroCombo, villainCombo)) continue;
    villainWeight += villainCombo.weight;
    checkNumerator += villainCombo.weight * showdownEv(args.spot, heroCombo, villainCombo);
    betNumerator +=
      villainCombo.weight *
      (villainActions[0] * args.spot.potBB +
        villainActions[1] * betCallEv(args.spot, args.config, heroCombo, villainCombo));
  }

  if (villainWeight <= 0) return { combo: key, inHeroRange: false, actions: [] };
  return {
    combo: key,
    inHeroRange: true,
    actions: [
      { action: "check", frequency: strategy[0], evBB: checkNumerator / villainWeight },
      {
        action: "bet",
        sizeBB: args.config.betSizeBB,
        frequency: strategy[1],
        evBB: betNumerator / villainWeight,
      },
    ],
  };
}

function buildRangeCombos(
  notation: string,
  board: Card[],
  boardBlockers: Set<string>,
): RangeCombo[] {
  const weights = compileRange(notation);
  const combos: RangeCombo[] = [];

  for (const [cls, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    for (const cards of combosForClass(cls)) {
      if (boardBlockers.has(formatCard(cards[0])) || boardBlockers.has(formatCard(cards[1])))
        continue;
      combos.push({
        cards,
        key: comboKey(cards),
        ids: [cardId(cards[0]), cardId(cards[1])],
        weight,
        score: evaluate7([...cards, ...board].map(encode)),
      });
    }
  }

  return dedupeCombos(combos).sort((a, b) => a.key.localeCompare(b.key));
}

function dedupeCombos(combos: RangeCombo[]): RangeCombo[] {
  const byKey = new Map<string, RangeCombo>();
  for (const combo of combos) {
    byKey.set(combo.key, combo);
  }
  return [...byKey.values()];
}

function combosForClass(cls: string): Array<[Card, Card]> {
  const r1 = rankFromChar(cls[0]);
  const r2 = rankFromChar(cls[1]);
  if (!r1 || !r2) return [];

  if (r1 === r2) {
    const pairs: Array<[Card, Card]> = [];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        const s1 = SUITS[i];
        const s2 = SUITS[j];
        if (s1 && s2)
          pairs.push([
            { rank: r1, suit: s1 },
            { rank: r2, suit: s2 },
          ]);
      }
    }
    return pairs;
  }

  const suffix = cls.slice(2);
  const suited = suffix === "s";
  const offsuit = suffix === "o";
  if (!suited && !offsuit) return [];

  const combos: Array<[Card, Card]> = [];
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (suited && s1 !== s2) continue;
      if (offsuit && s1 === s2) continue;
      combos.push([
        { rank: r1, suit: s1 },
        { rank: r2, suit: s2 },
      ]);
    }
  }
  return combos;
}

function makeSampler(combos: RangeCombo[]): { cumulative: number[]; total: number } {
  const cumulative: number[] = [];
  let total = 0;
  for (const combo of combos) {
    total += combo.weight;
    cumulative.push(total);
  }
  return { cumulative, total };
}

function sampleLegalPair(
  heroCombos: RangeCombo[],
  villainCombos: RangeCombo[],
  heroSampler: { cumulative: number[]; total: number },
  villainSampler: { cumulative: number[]; total: number },
  rng: () => number,
): { heroIndex: number; villainIndex: number } {
  for (let attempt = 0; attempt < 100; attempt++) {
    const heroIndex = sampleIndex(heroSampler, rng);
    const villainIndex = sampleIndex(villainSampler, rng);
    const hero = heroCombos[heroIndex];
    const villain = villainCombos[villainIndex];
    if (hero && villain && !overlaps(hero, villain)) return { heroIndex, villainIndex };
  }

  const heroIndex = sampleIndex(heroSampler, rng);
  const hero = heroCombos[heroIndex];
  if (!hero) return { heroIndex: 0, villainIndex: 0 };

  let total = 0;
  for (const villain of villainCombos) {
    if (!overlaps(hero, villain)) total += villain.weight;
  }
  let roll = rng() * total;
  for (let villainIndex = 0; villainIndex < villainCombos.length; villainIndex++) {
    const villain = villainCombos[villainIndex];
    if (!villain || overlaps(hero, villain)) continue;
    roll -= villain.weight;
    if (roll <= 0) return { heroIndex, villainIndex };
  }
  return { heroIndex, villainIndex: 0 };
}

function sampleIndex(sampler: { cumulative: number[]; total: number }, rng: () => number): number {
  const roll = rng() * sampler.total;
  let lo = 0;
  let hi = sampler.cumulative.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = sampler.cumulative[mid] ?? 0;
    if (roll <= value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function createNode(): CfrNode {
  return { regrets: [0, 0], strategySum: [0, 0], reach: 0 };
}

function regretMatching(node: CfrNode): [number, number] {
  const r0 = Math.max(0, node.regrets[0]);
  const r1 = Math.max(0, node.regrets[1]);
  const total = r0 + r1;
  if (total <= 0) return [0.5, 0.5];
  return [r0 / total, r1 / total];
}

function averageStrategy(node: CfrNode): [number, number] {
  const total = node.strategySum[0] + node.strategySum[1];
  if (total <= 0) return regretMatching(node);
  return [node.strategySum[0] / total, node.strategySum[1] / total];
}

function showdownShare(hero: RangeCombo, villain: RangeCombo): number {
  if (hero.score > villain.score) return 1;
  if (hero.score < villain.score) return 0;
  return 0.5;
}

function showdownEv(spot: Spot, hero: RangeCombo, villain: RangeCombo): number {
  return showdownShare(hero, villain) * spot.potBB;
}

function betCallEv(
  spot: Spot,
  config: NormalizedSolveConfig,
  hero: RangeCombo,
  villain: RangeCombo,
): number {
  return showdownShare(hero, villain) * (spot.potBB + config.betSizeBB * 2) - config.betSizeBB;
}

function countLegalPairs(heroCombos: RangeCombo[], villainCombos: RangeCombo[]): number {
  let pairs = 0;
  for (const hero of heroCombos) {
    for (const villain of villainCombos) {
      if (!overlaps(hero, villain)) pairs += 1;
    }
  }
  return pairs;
}

function overlaps(a: RangeCombo, b: RangeCombo): boolean {
  return (
    a.ids[0] === b.ids[0] || a.ids[0] === b.ids[1] || a.ids[1] === b.ids[0] || a.ids[1] === b.ids[1]
  );
}

function encode(card: Card): Encoded {
  return { rank: rankValue(card.rank), suit: SUIT_INDEX[card.suit] };
}

function cardId(card: Card): number {
  return rankValue(card.rank) * 4 + SUIT_INDEX[card.suit];
}

function comboKey([a, b]: [Card, Card]): string {
  return [formatCard(a), formatCard(b)].sort().join("");
}

function rankFromChar(ch: string | undefined): Rank | undefined {
  return Object.values(Rank).find((rank) => rank === ch);
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

function formatBB(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
