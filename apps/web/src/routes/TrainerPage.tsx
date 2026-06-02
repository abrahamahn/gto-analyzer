import {
  type ChartAction,
  DEFAULT_CHARTS,
  type EquityResult,
  HAND_CLASSES,
  type PreflopChart,
  comboCount,
  compileRange,
  evaluateHand,
  loadDefaultCharts,
} from "@poker/engine";
import {
  type ActionType,
  type Card,
  type Position,
  Rank,
  type Spot,
  Suit,
  formatCard,
  parseCard,
} from "@poker/shared";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type SolverActionResult, type SolverResult, api } from "../lib/api.js";
import type { EquitySimulationPayload, EquitySimulationResponse } from "../lib/equitySimulation.js";
import { ACTION_COLOR, ACTION_LABEL, sortActions } from "../lib/strategy.js";

loadDefaultCharts();

type Street = "preflop" | "flop" | "turn" | "river";
type GameFormat = "cash" | "mtt";
type TrainerMode = "simple" | "advanced";
type SolverStatus = "idle" | "running" | "cached" | "complete" | "error";

interface ActionLike {
  type: ActionType;
  sizeBB?: number;
}

interface ActionSummary extends ActionLike {
  key: string;
  combos: number;
}

interface ParsedSpot {
  hero?: [Card, Card];
  board: Card[];
  error?: string;
}

interface RangeCombos {
  combos: Array<[Card, Card]>;
  uniqueCombos: number;
}

interface ActionEvEstimate extends ActionLike {
  evBB: number | undefined;
  note: string;
}

interface BeginnerRecommendation {
  action?: ActionType;
  title: string;
  source: string;
  detail: string;
  metric?: string;
}

type SimulationStatus = "idle" | "running" | "cached" | "complete" | "error";

const TOTAL_COMBOS = 1326;
const EQUITY_CACHE_PREFIX = "poker:equity-sim:v1:";
const MAX_CACHED_SIMULATIONS = 60;
const POSITION_ORDER: readonly Position[] = ["UTG", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
const SCENARIO_ORDER = ["RFI", "Push/fold (jam)", "BB call vs SB jam", "BB vs BTN open"];
const STREET_ORDER: readonly Street[] = ["preflop", "flop", "turn", "river"];
const BOARD_SLOTS: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const DEFAULT_RANGE = "22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo";
const ACTION_CHOICES: readonly ActionType[] = ["fold", "check", "call", "bet", "raise", "all-in"];
const SUITS: readonly Suit[] = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs];
const HERO_CARD_INDEXES = [0, 1] as const;
const BOARD_CARD_KEYS = ["flop-1", "flop-2", "flop-3", "turn", "river"] as const;

const POSITIONS_BY_PLAYERS: Record<number, readonly Position[]> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["UTG", "BTN", "SB", "BB"],
  5: ["UTG", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

const CHARTS = [...DEFAULT_CHARTS].sort((a, b) => {
  if (a.format !== b.format) return a.format.localeCompare(b.format);
  if (a.stackBB !== b.stackBB) return b.stackBB - a.stackBB;
  if (a.scenario !== b.scenario) return scenarioIndex(a.scenario) - scenarioIndex(b.scenario);
  return POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
});
const FALLBACK_HAND_CLASS = getFallbackHandClass();

export function TrainerPage() {
  const [format, setFormat] = useState<GameFormat>("cash");
  const [trainerMode, setTrainerMode] = useState<TrainerMode>("simple");
  const [street, setStreet] = useState<Street>("preflop");
  const [playerCount, setPlayerCount] = useState(6);
  const [heroPosition, setHeroPosition] = useState<Position>("BTN");
  const [aggressorPosition, setAggressorPosition] = useState<Position>("CO");
  const [potBB, setPotBB] = useState(1.5);
  const [toCallBB, setToCallBB] = useState(0);
  const [heroStackBB, setHeroStackBB] = useState(100);
  const [simulationIterations, setSimulationIterations] = useState(50000);
  const [solverIterations, setSolverIterations] = useState(50000);
  const [aggressiveSizeBB, setAggressiveSizeBB] = useState(6);
  const [foldEquityPct, setFoldEquityPct] = useState(25);
  const [villainStacks, setVillainStacks] = useState<number[]>([100, 100, 100, 100, 100]);
  const [villainInHand, setVillainInHand] = useState<boolean[]>([true, false, false, false, false]);
  const [heroCardTexts, setHeroCardTexts] = useState<[string, string]>(["As", "Ks"]);
  const [boardCardTexts, setBoardCardTexts] = useState<[string, string, string, string, string]>([
    "Qh",
    "Td",
    "2c",
    "",
    "",
  ]);
  const [heroRange, setHeroRange] = useState(DEFAULT_RANGE);
  const [villainRange, setVillainRange] = useState(DEFAULT_RANGE);
  const [selectedAction, setSelectedAction] = useState<ActionType>("raise");
  const [equity, setEquity] = useState<EquityResult | undefined>();
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("idle");
  const [simulationError, setSimulationError] = useState<string | undefined>();
  const [solverResult, setSolverResult] = useState<SolverResult | undefined>();
  const [solverStatus, setSolverStatus] = useState<SolverStatus>("idle");
  const [solverError, setSolverError] = useState<string | undefined>();
  const requestIdRef = useRef(0);

  const positions = positionsFor(playerCount);
  const villainPositions = positions.filter((position) => position !== heroPosition);
  const activeVillainStacks = villainPositions.map(
    (_, index) => villainStacks[index] ?? heroStackBB,
  );
  const activeVillainInHand = normalizedInHand(villainInHand, activeVillainStacks.length);
  const opponentsInHand = activeVillainInHand.filter(Boolean).length;
  const contestVillainStacks = activeVillainStacks.filter((_, index) => activeVillainInHand[index]);
  const effectiveStackBB = Math.min(heroStackBB, Math.max(...contestVillainStacks));
  const shortestStackBB = Math.min(heroStackBB, ...contestVillainStacks);
  const spr = potBB > 0 ? effectiveStackBB / potBB : 0;
  const potOdds = toCallBB > 0 ? toCallBB / (potBB + toCallBB) : 0;

  const parsedSpot = useMemo(
    () => parseSpotCards(heroCardTexts, boardCardTexts, street),
    [heroCardTexts, boardCardTexts, street],
  );
  const selectedClass = parsedSpot.hero ? handClassFromCards(parsedSpot.hero) : FALLBACK_HAND_CLASS;
  const chart = useMemo(
    () =>
      findSpotChart(format, street, effectiveStackBB, heroPosition, aggressorPosition, toCallBB),
    [format, street, effectiveStackBB, heroPosition, aggressorPosition, toCallBB],
  );
  const selectedMix = useMemo(
    () => (chart ? sortActions(evaluateHand(chart, selectedClass)) : []),
    [chart, selectedClass],
  );
  const actionSummary = useMemo(() => (chart ? summarizeChart(chart) : []), [chart]);
  const legalActions = legalActionsFor(street, toCallBB);
  const selectedActionLegal = legalActions.includes(selectedAction);
  const selectedActionFrequency = chart ? frequencyForAction(selectedMix, selectedAction) : null;

  const rangeCombos = useMemo(
    () =>
      parsedSpot.hero
        ? buildVillainCombos(villainRange, [...parsedSpot.hero, ...parsedSpot.board])
        : { error: parsedSpot.error ?? "Enter two hero cards." },
    [villainRange, parsedSpot],
  );
  const simulationPayload = useMemo<EquitySimulationPayload | undefined>(() => {
    if (!parsedSpot.hero || "error" in rangeCombos) return undefined;
    return {
      hero: parsedSpot.hero,
      board: parsedSpot.board,
      villainRange: rangeCombos.combos,
      opponents: opponentsInHand,
      iterations: simulationIterations,
    };
  }, [opponentsInHand, parsedSpot, rangeCombos, simulationIterations]);
  const simulationCacheKey = useMemo(
    () =>
      parsedSpot.hero && !("error" in rangeCombos)
        ? equityCacheKey({
            hero: parsedSpot.hero,
            board: parsedSpot.board,
            range: villainRange,
            opponents: opponentsInHand,
            iterations: simulationIterations,
          })
        : undefined,
    [opponentsInHand, parsedSpot, rangeCombos, simulationIterations, villainRange],
  );
  const actionEvs = useMemo(
    () =>
      estimateActionEvs({
        equity: equity?.equity,
        potBB,
        toCallBB,
        aggressiveSizeBB,
        allInSizeBB: effectiveStackBB,
        foldEquity: foldEquityPct / 100,
      }),
    [aggressiveSizeBB, effectiveStackBB, equity, foldEquityPct, potBB, toCallBB],
  );
  const solverBetSizeBB = Math.min(aggressiveSizeBB, effectiveStackBB);
  const solverUnavailableReason = riverSolverUnavailableReason({
    street,
    toCallBB,
    opponentsInHand,
    parsedSpot,
    betSizeBB: solverBetSizeBB,
  });
  const beginnerRecommendation = useMemo(
    () =>
      getBeginnerRecommendation({
        street,
        chart,
        selectedMix,
        equity,
        simulationStatus,
        potOdds,
        toCallBB,
        actionEvs,
        solverResult,
        solverStatus,
        solverBetSizeBB,
        legalActions,
      }),
    [
      actionEvs,
      chart,
      equity,
      potOdds,
      selectedMix,
      simulationStatus,
      solverBetSizeBB,
      solverResult,
      solverStatus,
      street,
      toCallBB,
      legalActions,
    ],
  );
  const solverInputKey = useMemo(
    () =>
      JSON.stringify({
        street,
        heroPosition,
        effectiveStackBB,
        potBB,
        toCallBB,
        heroCards: heroCardTexts,
        boardCards: boardCardTexts,
        heroRange,
        villainRange,
        opponentsInHand,
        betSizeBB: solverBetSizeBB,
        iterations: solverIterations,
      }),
    [
      boardCardTexts,
      effectiveStackBB,
      heroCardTexts,
      heroPosition,
      heroRange,
      opponentsInHand,
      potBB,
      solverBetSizeBB,
      solverIterations,
      street,
      toCallBB,
      villainRange,
    ],
  );

  useEffect(() => {
    if (!simulationPayload || !simulationCacheKey) {
      setEquity(undefined);
      setSimulationStatus("idle");
      setSimulationError(undefined);
      return;
    }

    const cached = readEquityCache(simulationCacheKey);
    if (cached) {
      setEquity(cached);
      setSimulationStatus("cached");
      setSimulationError(undefined);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setEquity(undefined);
    setSimulationStatus("running");
    setSimulationError(undefined);

    const worker = new Worker(new URL("../workers/equitySimulation.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<EquitySimulationResponse>) => {
      if (event.data.id !== requestIdRef.current) return;
      if (event.data.ok) {
        setEquity(event.data.result);
        setSimulationStatus("complete");
        writeEquityCache(simulationCacheKey, event.data.result);
      } else {
        setEquity(undefined);
        setSimulationStatus("error");
        setSimulationError(event.data.error);
      }
      worker.terminate();
    };
    worker.onerror = (event) => {
      if (requestId !== requestIdRef.current) return;
      setEquity(undefined);
      setSimulationStatus("error");
      setSimulationError(event.message || "simulation worker failed");
      worker.terminate();
    };
    worker.postMessage({ id: requestId, payload: simulationPayload });

    return () => {
      worker.terminate();
    };
  }, [simulationCacheKey, simulationPayload]);

  useEffect(() => {
    if (!solverInputKey) return;
    setSolverResult(undefined);
    setSolverStatus("idle");
    setSolverError(undefined);
  }, [solverInputKey]);

  function setPlayers(next: number) {
    setPlayerCount(next);
    setVillainStacks((prev) =>
      Array.from({ length: Math.max(1, next - 1) }, (_, i) => prev[i] ?? heroStackBB),
    );
    setVillainInHand((prev) =>
      Array.from({ length: Math.max(1, next - 1) }, (_, i) => prev[i] ?? i === 0),
    );
    const nextPositions = positionsFor(next);
    if (!nextPositions.includes(heroPosition)) setHeroPosition(nextPositions[0] ?? "BTN");
    if (!nextPositions.includes(aggressorPosition)) setAggressorPosition(nextPositions[0] ?? "BTN");
  }

  function toggleVillainInHand(index: number) {
    setVillainInHand((prev) => {
      const normalized = normalizedInHand(prev, activeVillainStacks.length);
      const currentlyIn = normalized[index] ?? false;
      if (currentlyIn && normalized.filter(Boolean).length <= 1) return normalized;
      return normalized.map((value, i) => (i === index ? !value : value));
    });
  }

  function setGridHand(cls: string) {
    setHeroCardTexts(representativeCards(cls));
    setSelectedAction(defaultActionFor(chart));
  }

  async function runRiverSolve() {
    if (solverUnavailableReason) {
      setSolverStatus("error");
      setSolverError(solverUnavailableReason);
      return;
    }

    const spot = buildManualSpot({
      street,
      heroPosition,
      effectiveStackBB,
      potBB,
      toCallBB,
      parsedSpot,
    });
    if (!spot) {
      setSolverStatus("error");
      setSolverError(parsedSpot.error ?? "Enter a complete river spot.");
      return;
    }

    setSolverStatus("running");
    setSolverError(undefined);
    try {
      const response = await api.solveSpot({
        spot,
        heroRange,
        villainRange,
        tree: {
          betSizeBB: solverBetSizeBB,
          iterations: solverIterations,
        },
      });
      setSolverResult(response.result);
      setSolverStatus(response.cached ? "cached" : "complete");
    } catch (err) {
      setSolverResult(undefined);
      setSolverStatus("error");
      setSolverError(err instanceof Error ? err.message : "Solver failed.");
    }
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trainer</h1>
          <p className="mt-1 text-sm text-neutral-400">One spot, one decision.</p>
        </div>
        <button
          type="button"
          onClick={() => setGridHand(randomClass())}
          className="w-fit rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600"
        >
          Random hand
        </button>
      </div>

      <section className="rounded border border-neutral-800 p-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <ControlGroup label="View">
            {(["simple", "advanced"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={trainerMode === value}
                onClick={() => setTrainerMode(value)}
                className={segmentClass(trainerMode === value)}
              >
                {value === "simple" ? "Simple" : "Advanced"}
              </button>
            ))}
          </ControlGroup>

          <ControlGroup label="Format">
            {(["cash", "mtt"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={format === value}
                onClick={() => setFormat(value)}
                className={segmentClass(format === value)}
              >
                {value === "cash" ? "Cash" : "Tournament"}
              </button>
            ))}
          </ControlGroup>

          <ControlGroup label="Street">
            {STREET_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={street === value}
                onClick={() => setStreet(value)}
                className={segmentClass(street === value)}
              >
                {titleCase(value)}
              </button>
            ))}
          </ControlGroup>
        </div>

        <PokerTableSetup
          positions={positions}
          playerCount={playerCount}
          onPlayerCountChange={setPlayers}
          heroPosition={heroPosition}
          onHeroPositionChange={setHeroPosition}
          heroStackBB={heroStackBB}
          onHeroStackChange={setHeroStackBB}
          villainStacks={activeVillainStacks}
          onVillainStackChange={(index, value) =>
            updateVillainStack(setVillainStacks, index, value)
          }
          villainInHand={activeVillainInHand}
          onVillainInHandToggle={toggleVillainInHand}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Pot BB" value={potBB} step={0.5} onChange={setPotBB} />
          <NumberField label="To call BB" value={toCallBB} step={0.5} onChange={setToCallBB} />
          <SelectField
            label="Aggressor"
            value={aggressorPosition}
            options={positions.filter((p) => p !== heroPosition)}
            onChange={setAggressorPosition}
          />
        </div>

        {trainerMode === "advanced" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <NumberField
              label="Sim hands"
              value={simulationIterations}
              step={10000}
              onChange={(value) => setSimulationIterations(clamp(Math.round(value), 1000, 1000000))}
            />
            <NumberField
              label="Solve iters"
              value={solverIterations}
              step={10000}
              onChange={(value) => setSolverIterations(clamp(Math.round(value), 1000, 1000000))}
            />
            <NumberField
              label="Bet/raise BB"
              value={aggressiveSizeBB}
              step={0.5}
              onChange={setAggressiveSizeBB}
            />
            <NumberField
              label="Fold equity %"
              value={foldEquityPct}
              step={1}
              onChange={(value) => setFoldEquityPct(clamp(value, 0, 100))}
            />
            <Metric label="Simulation" value="Monte Carlo" />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Bet size"
              value={aggressiveSizeBB}
              step={0.5}
              onChange={setAggressiveSizeBB}
            />
            <Metric
              label="Equity"
              value={equity ? pct(equity.equity) : statusWord(simulationStatus)}
            />
            <Metric label="Price" value={toCallBB > 0 ? pct(potOdds) : "Free"} />
            <Metric
              label="Source"
              value={
                street === "preflop"
                  ? chart
                    ? "Chart"
                    : "None"
                  : solverResult
                    ? "Solver"
                    : "Equity"
              }
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Hero hand
            </div>
            <div className="grid grid-cols-2 gap-2">
              {HERO_CARD_INDEXES.map((index) => (
                <input
                  key={`hero-${index}`}
                  value={heroCardTexts[index]}
                  onChange={(e) =>
                    setHeroCardTexts((prev) =>
                      index === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value],
                    )
                  }
                  className="h-9 rounded border border-neutral-800 bg-neutral-950 px-3 font-mono text-sm outline-none focus:border-emerald-600"
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Board
            </div>
            <div className="grid grid-cols-5 gap-2">
              {BOARD_CARD_KEYS.map((key, index) => {
                const value = boardCardTexts[index] ?? "";
                const active = index < BOARD_SLOTS[street];
                return (
                  <input
                    key={key}
                    value={active ? value : ""}
                    disabled={!active}
                    onChange={(e) =>
                      setBoardCardTexts((prev) => replaceTupleValue(prev, index, e.target.value))
                    }
                    className="h-9 rounded border border-neutral-800 bg-neutral-950 px-2 text-center font-mono text-sm outline-none focus:border-emerald-600 disabled:border-neutral-900 disabled:bg-neutral-950/40 disabled:text-neutral-700"
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Effective" value={`${fmt(effectiveStackBB)}bb`} />
          {trainerMode === "advanced" && (
            <Metric label="Shortest" value={`${fmt(shortestStackBB)}bb`} />
          )}
          {trainerMode === "advanced" && <Metric label="SPR" value={fmt(spr)} />}
          <Metric label="Opponents" value={`${opponentsInHand}`} />
          <Metric label="Pot odds" value={toCallBB > 0 ? pct(potOdds) : "0%"} />
          {trainerMode === "advanced" && (
            <Metric
              label="Chart pack"
              value={chart ? `${chart.format} ${chart.stackBB}bb` : "none"}
            />
          )}
          <Metric label="Hero class" value={selectedClass} />
        </div>
      </section>

      {trainerMode === "simple" ? (
        <BeginnerPanel
          street={street}
          format={format}
          selectedClass={selectedClass}
          heroPosition={heroPosition}
          aggressorPosition={aggressorPosition}
          effectiveStackBB={effectiveStackBB}
          potBB={potBB}
          toCallBB={toCallBB}
          opponentsInHand={opponentsInHand}
          legalActions={legalActions}
          selectedAction={selectedAction}
          onSelectedActionChange={setSelectedAction}
          recommendation={beginnerRecommendation}
          equity={equity}
          simulationStatus={simulationStatus}
          simulationError={simulationError}
          potOdds={potOdds}
          chart={chart}
          selectedMix={selectedMix}
          solverResult={solverResult}
          solverStatus={solverStatus}
          solverUnavailableReason={solverUnavailableReason}
          onRunSolver={runRiverSolve}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="min-w-0 space-y-4">
            {street === "preflop" && (
              <PreflopChartPanel
                chart={chart}
                selectedClass={selectedClass}
                actionSummary={actionSummary}
                onSelectClass={setGridHand}
              />
            )}

            {street !== "preflop" && (
              <PostflopPanel
                street={street}
                heroRange={heroRange}
                onHeroRangeChange={setHeroRange}
                villainRange={villainRange}
                onVillainRangeChange={setVillainRange}
                parsedSpot={parsedSpot}
                rangeCombos={rangeCombos}
                equity={equity}
                simulationStatus={simulationStatus}
                simulationError={simulationError}
                opponentsInHand={opponentsInHand}
                simulationIterations={simulationIterations}
                potOdds={potOdds}
                toCallBB={toCallBB}
                solverResult={solverResult}
                solverStatus={solverStatus}
                solverError={solverError}
                solverUnavailableReason={solverUnavailableReason}
                solverIterations={solverIterations}
                solverBetSizeBB={solverBetSizeBB}
                onRunSolver={runRiverSolve}
              />
            )}
          </section>

          <section className="rounded border border-neutral-800 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">{selectedClass}</h2>
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                {comboCount(selectedClass)} combos
              </span>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Your action
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ACTION_CHOICES.map((type) => {
                  const legal = legalActions.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={selectedAction === type}
                      onClick={() => setSelectedAction(type)}
                      className={`rounded px-2 py-1.5 text-sm font-medium ${
                        selectedAction === type
                          ? "bg-neutral-100 text-neutral-950"
                          : legal
                            ? "bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                            : "bg-neutral-950 text-neutral-600 hover:bg-neutral-900"
                      }`}
                    >
                      {ACTION_LABEL[type]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 rounded border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-sm">
              <div className={selectedActionLegal ? "text-emerald-300" : "text-amber-300"}>
                {selectedActionLegal ? "Legal in this spot" : "Not legal from this setup"}
              </div>
              {chart && (
                <div className="mt-1 text-neutral-400">
                  Chart frequency:{" "}
                  <span className="text-neutral-100">
                    {selectedActionFrequency === null ? "n/a" : pct(selectedActionFrequency)}
                  </span>
                </div>
              )}
            </div>

            {chart && (
              <div className="mt-5 space-y-3">
                {selectedMix.map((a) => (
                  <div key={actionKey(a)}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span>{actionLabel(a)}</span>
                      <span className="tabular-nums text-neutral-300">{pct(a.frequency)}</span>
                    </div>
                    <div className="h-2 rounded bg-neutral-900">
                      <div
                        className="h-2 rounded"
                        style={{ width: pct(a.frequency), backgroundColor: ACTION_COLOR[a.type] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {equity && (
              <div className="mt-5 rounded border border-neutral-800 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Call check
                </div>
                <div className="mt-2 text-2xl font-semibold">{pct(equity.equity)}</div>
                <div className="mt-1 text-sm text-neutral-400">
                  {toCallBB > 0
                    ? equity.equity >= potOdds
                      ? "Equity clears pot odds."
                      : "Equity is below pot odds."
                    : "No call price set."}
                </div>
              </div>
            )}

            {equity && (
              <div className="mt-5 rounded border border-neutral-800 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Action EV model
                </div>
                <div className="mt-3 space-y-2">
                  {actionEvs.map((estimate) => (
                    <div
                      key={actionKey(estimate)}
                      className={`rounded border px-3 py-2 ${
                        selectedAction === estimate.type
                          ? "border-emerald-700 bg-emerald-950/20"
                          : "border-neutral-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>{ACTION_LABEL[estimate.type]}</span>
                        <span className="font-semibold tabular-nums">
                          {estimate.evBB === undefined ? "n/a" : `${signed(estimate.evBB)}bb`}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">{estimate.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function PreflopChartPanel({
  chart,
  selectedClass,
  actionSummary,
  onSelectClass,
}: {
  chart: PreflopChart | undefined;
  selectedClass: string;
  actionSummary: ActionSummary[];
  onSelectClass: (cls: string) => void;
}) {
  if (!chart) {
    return (
      <section className="rounded border border-neutral-800 p-6 text-sm text-neutral-400">
        No shipped preflop chart matches this exact stack, position, and facing-action setup yet.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{chartTitle(chart)}</h2>
        {chart.description && <p className="mt-1 text-sm text-neutral-400">{chart.description}</p>}
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <div
          className="grid min-w-[42rem]"
          style={{ gridTemplateColumns: "repeat(13, minmax(2.75rem, 1fr))" }}
        >
          {HAND_CLASSES.map((cls) => {
            const mix = sortActions(evaluateHand(chart, cls));
            const isSelected = cls === selectedClass;
            return (
              <button
                key={cls}
                type="button"
                title={`${cls}: ${mixLabel(mix)}`}
                onClick={() => onSelectClass(cls)}
                className={`h-11 border-b border-r border-neutral-950 px-1 text-xs font-semibold tabular-nums text-white outline-none transition hover:brightness-125 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  isSelected ? "ring-2 ring-inset ring-emerald-300" : ""
                }`}
                style={{ background: mixBackground(mix) }}
              >
                {cls}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {actionSummary.map((a) => (
          <div key={a.key} className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-xs text-neutral-500">{actionLabel(a)}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {pct(a.combos / TOTAL_COMBOS)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BeginnerPanel({
  street,
  format,
  selectedClass,
  heroPosition,
  aggressorPosition,
  effectiveStackBB,
  potBB,
  toCallBB,
  opponentsInHand,
  legalActions,
  selectedAction,
  onSelectedActionChange,
  recommendation,
  equity,
  simulationStatus,
  simulationError,
  potOdds,
  selectedMix,
  solverResult,
  solverStatus,
  solverUnavailableReason,
  onRunSolver,
}: {
  street: Street;
  format: GameFormat;
  selectedClass: string;
  heroPosition: Position;
  aggressorPosition: Position;
  effectiveStackBB: number;
  potBB: number;
  toCallBB: number;
  opponentsInHand: number;
  legalActions: ActionType[];
  selectedAction: ActionType;
  onSelectedActionChange: (action: ActionType) => void;
  recommendation: BeginnerRecommendation;
  equity: EquityResult | undefined;
  simulationStatus: SimulationStatus;
  simulationError: string | undefined;
  potOdds: number;
  chart: PreflopChart | undefined;
  selectedMix: ChartAction[];
  solverResult: SolverResult | undefined;
  solverStatus: SolverStatus;
  solverUnavailableReason: string | undefined;
  onRunSolver: () => void;
}) {
  const recommendedAction = recommendation.action;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-4">
        <div className="rounded border border-neutral-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Decision
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Metric label="Hand" value={selectedClass} />
            <Metric label="Position" value={heroPosition} />
            <Metric label="Spot" value={`${titleCase(street)} ${format.toUpperCase()}`} />
            <Metric label="Pot" value={`${fmt(potBB)}bb`} />
            <Metric label="To call" value={toCallBB > 0 ? `${fmt(toCallBB)}bb` : "0bb"} />
            <Metric label="Stack" value={`${fmt(effectiveStackBB)}bb`} />
            <Metric label="Opponents" value={`${opponentsInHand}`} />
            <Metric label="Aggressor" value={aggressorPosition} />
            <Metric label="Price" value={toCallBB > 0 ? pct(potOdds) : "Free"} />
          </div>
        </div>

        <div className="rounded border border-neutral-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Recommended play
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-3xl font-semibold text-emerald-300">{recommendation.title}</div>
              <div className="mt-1 text-sm text-neutral-400">{recommendation.detail}</div>
            </div>
            <div className="rounded border border-neutral-800 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Source</div>
              <div className="mt-1 font-semibold">{recommendation.source}</div>
            </div>
          </div>
          {recommendation.metric && (
            <div className="mt-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              {recommendation.metric}
            </div>
          )}
          {street === "river" && !solverResult && (
            <button
              type="button"
              onClick={onRunSolver}
              disabled={solverStatus === "running" || Boolean(solverUnavailableReason)}
              className="mt-4 rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:bg-neutral-900 disabled:text-neutral-600"
            >
              {solverStatus === "running" ? "Solving..." : "Solve this river"}
            </button>
          )}
          {solverUnavailableReason && street === "river" && (
            <div className="mt-3 text-sm text-amber-300">{solverUnavailableReason}</div>
          )}
        </div>

        <div className="rounded border border-neutral-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Choose an action
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {ACTION_CHOICES.map((type) => {
              const legal = legalActions.includes(type);
              const recommended = type === recommendedAction;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={selectedAction === type}
                  disabled={!legal}
                  onClick={() => onSelectedActionChange(type)}
                  className={`min-h-11 rounded border px-2 py-2 text-sm font-medium ${
                    recommended
                      ? "border-emerald-500 bg-emerald-950/50 text-emerald-200"
                      : selectedAction === type
                        ? "border-neutral-200 bg-neutral-100 text-neutral-950"
                        : legal
                          ? "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                          : "border-neutral-900 bg-neutral-950 text-neutral-700"
                  }`}
                >
                  {ACTION_LABEL[type]}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded border border-neutral-800 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Quick read
        </div>
        <div className="mt-3 space-y-3">
          <Metric
            label="Equity"
            value={equity ? pct(equity.equity) : statusWord(simulationStatus)}
          />
          <Metric label="Pot odds" value={toCallBB > 0 ? pct(potOdds) : "No call"} />
          <Metric
            label="Solver"
            value={
              solverResult
                ? solverStatusLabel(solverStatus)
                : street === "river"
                  ? "Ready"
                  : "River only"
            }
          />
        </div>
        {simulationError && <div className="mt-3 text-sm text-red-300">{simulationError}</div>}
        {selectedMix.length > 0 && (
          <div className="mt-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Chart mix
            </div>
            {selectedMix.slice(0, 3).map((action) => (
              <div key={actionKey(action)}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{actionLabel(action)}</span>
                  <span className="tabular-nums text-neutral-400">{pct(action.frequency)}</span>
                </div>
                <div className="h-2 rounded bg-neutral-900">
                  <div
                    className="h-2 rounded"
                    style={{
                      width: pct(action.frequency),
                      backgroundColor: ACTION_COLOR[action.type],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PostflopPanel({
  street,
  heroRange,
  onHeroRangeChange,
  villainRange,
  onVillainRangeChange,
  parsedSpot,
  rangeCombos,
  equity,
  simulationStatus,
  simulationError,
  opponentsInHand,
  simulationIterations,
  potOdds,
  toCallBB,
  solverResult,
  solverStatus,
  solverError,
  solverUnavailableReason,
  solverIterations,
  solverBetSizeBB,
  onRunSolver,
}: {
  street: Street;
  heroRange: string;
  onHeroRangeChange: (value: string) => void;
  villainRange: string;
  onVillainRangeChange: (value: string) => void;
  parsedSpot: ParsedSpot;
  rangeCombos: RangeCombos | { error: string };
  equity: EquityResult | undefined;
  simulationStatus: SimulationStatus;
  simulationError: string | undefined;
  opponentsInHand: number;
  simulationIterations: number;
  potOdds: number;
  toCallBB: number;
  solverResult: SolverResult | undefined;
  solverStatus: SolverStatus;
  solverError: string | undefined;
  solverUnavailableReason: string | undefined;
  solverIterations: number;
  solverBetSizeBB: number;
  onRunSolver: () => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="rounded border border-neutral-800 p-4">
        <h2 className="text-lg font-semibold">Postflop ranges</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Applied to each of {opponentsInHand} opponent{opponentsInHand === 1 ? "" : "s"} in the
          hand. Monte Carlo target: {simulationIterations.toLocaleString()} deals.
        </p>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Hero range
          </span>
          <textarea
            value={heroRange}
            onChange={(e) => onHeroRangeChange(e.target.value)}
            rows={4}
            className="w-full resize-none rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-sm outline-none focus:border-emerald-600"
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Villain range
          </span>
          <textarea
            value={villainRange}
            onChange={(e) => onVillainRangeChange(e.target.value)}
            rows={5}
            className="w-full resize-none rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-sm outline-none focus:border-emerald-600"
          />
        </label>
      </div>

      <div className="rounded border border-neutral-800 p-4">
        <h2 className="text-lg font-semibold">Equity</h2>
        {parsedSpot.error && <p className="mt-3 text-sm text-amber-300">{parsedSpot.error}</p>}
        {"error" in rangeCombos && (
          <p className="mt-3 text-sm text-amber-300">{rangeCombos.error}</p>
        )}
        {simulationStatus === "running" && (
          <p className="mt-3 text-sm text-neutral-400">
            Simulating {simulationIterations.toLocaleString()} deals in a worker...
          </p>
        )}
        {simulationStatus === "error" && (
          <p className="mt-3 text-sm text-red-300">{simulationError ?? "Simulation failed."}</p>
        )}
        {equity && !("error" in rangeCombos) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Hero equity" value={pct(equity.equity)} />
            <Metric label="Source" value={simulationStatus === "cached" ? "Cache" : "Worker"} />
            <Metric label="Opponents" value={`${opponentsInHand}`} />
            <Metric label="Range combos" value={`${rangeCombos.uniqueCombos}`} />
            <Metric label="Win" value={pct(equity.win)} />
            <Metric label="Tie" value={pct(equity.tie)} />
            <Metric label="Lose" value={pct(equity.lose)} />
            <Metric label="Counted deals" value={`${equity.iterations.toLocaleString()}`} />
          </div>
        )}
        {equity && toCallBB > 0 && (
          <div
            className={`mt-4 rounded border px-3 py-2 text-sm ${
              equity.equity >= potOdds
                ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
                : "border-red-800 bg-red-950/30 text-red-200"
            }`}
          >
            Equity {pct(equity.equity)} vs pot odds {pct(potOdds)}
          </div>
        )}
      </div>

      <RiverSolverPanel
        street={street}
        result={solverResult}
        status={solverStatus}
        error={solverError}
        unavailableReason={solverUnavailableReason}
        iterations={solverIterations}
        betSizeBB={solverBetSizeBB}
        onRunSolver={onRunSolver}
      />
    </section>
  );
}

function RiverSolverPanel({
  street,
  result,
  status,
  error,
  unavailableReason,
  iterations,
  betSizeBB,
  onRunSolver,
}: {
  street: Street;
  result: SolverResult | undefined;
  status: SolverStatus;
  error: string | undefined;
  unavailableReason: string | undefined;
  iterations: number;
  betSizeBB: number;
  onRunSolver: () => void;
}) {
  const disabled = status === "running" || Boolean(unavailableReason);
  return (
    <div className="rounded border border-neutral-800 p-4 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">River solver</h2>
          <div className="mt-1 text-sm text-neutral-400">Heads-up river fixed-bet CFR</div>
        </div>
        <button
          type="button"
          onClick={onRunSolver}
          disabled={disabled}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          {status === "running" ? "Solving..." : "Solve river"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Street" value={titleCase(street)} />
        <Metric label="Bet size" value={`${fmt(betSizeBB)}bb`} />
        <Metric label="Iterations" value={iterations.toLocaleString()} />
        <Metric label="Status" value={solverStatusLabel(status)} />
      </div>

      {unavailableReason && (
        <div className="mt-4 rounded border border-amber-900 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
          {unavailableReason}
        </div>
      )}
      {status === "error" && error && (
        <div className="mt-4 rounded border border-red-900 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Source" value="River CFR" />
            <Metric label="Cache" value={status === "cached" ? "Hit" : "Miss"} />
            <Metric label="Legal pairs" value={result.ranges.legalPairs.toLocaleString()} />
            <Metric label="Exploitability" value={`${fmt(result.exploitabilityBB)}bb`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SolverStrategyList title="Range strategy" actions={result.actions} />
            <SolverStrategyList
              title={
                result.handStrategy ? `${result.handStrategy.combo} strategy` : "Hand strategy"
              }
              actions={result.handStrategy?.actions ?? []}
              empty={
                result.handStrategy?.inHeroRange === false
                  ? "Exact hero hand is outside the hero range."
                  : "No exact hand strategy returned."
              }
            />
          </div>

          <div className="space-y-1 text-xs text-neutral-500">
            {result.notes.slice(0, 2).map((note) => (
              <div key={note}>{note}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SolverStrategyList({
  title,
  actions,
  empty,
}: {
  title: string;
  actions: SolverActionResult[];
  empty?: string;
}) {
  return (
    <div className="rounded border border-neutral-800 p-3">
      <div className="text-xs font-semibold tracking-wide text-neutral-500">{title}</div>
      {actions.length === 0 ? (
        <div className="mt-3 text-sm text-amber-300">{empty ?? "No strategy available."}</div>
      ) : (
        <div className="mt-3 space-y-3">
          {actions.map((action) => (
            <div key={solverActionKey(action)}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span>{solverActionLabel(action)}</span>
                <span className="tabular-nums text-neutral-300">
                  {pct(action.frequency)} / {signed(action.evBB)}bb
                </span>
              </div>
              <div className="h-2 rounded bg-neutral-900">
                <div
                  className="h-2 rounded"
                  style={{
                    width: pct(clamp(action.frequency, 0, 1)),
                    backgroundColor: ACTION_COLOR[action.action],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PokerTableSetup({
  positions,
  playerCount,
  onPlayerCountChange,
  heroPosition,
  onHeroPositionChange,
  heroStackBB,
  onHeroStackChange,
  villainStacks,
  onVillainStackChange,
  villainInHand,
  onVillainInHandToggle,
}: {
  positions: readonly Position[];
  playerCount: number;
  onPlayerCountChange: (value: number) => void;
  heroPosition: Position;
  onHeroPositionChange: (position: Position) => void;
  heroStackBB: number;
  onHeroStackChange: (value: number) => void;
  villainStacks: readonly number[];
  onVillainStackChange: (index: number, value: number) => void;
  villainInHand: readonly boolean[];
  onVillainInHandToggle: (index: number) => void;
}) {
  let villainIndex = -1;
  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Table
          </div>
          <div className="mt-1 text-sm text-neutral-300">{playerCount}-max spot</div>
        </div>
        <div className="flex items-center gap-1 rounded bg-neutral-950 p-1">
          <button
            type="button"
            onClick={() => onPlayerCountChange(Math.max(2, playerCount - 1))}
            className="h-8 w-8 rounded text-lg text-neutral-300 hover:bg-neutral-900 disabled:text-neutral-700"
            disabled={playerCount <= 2}
            aria-label="Remove player"
          >
            -
          </button>
          <div className="min-w-12 text-center text-sm tabular-nums">{playerCount}</div>
          <button
            type="button"
            onClick={() => onPlayerCountChange(Math.min(9, playerCount + 1))}
            className="h-8 w-8 rounded text-lg text-neutral-300 hover:bg-neutral-900 disabled:text-neutral-700"
            disabled={playerCount >= 9}
            aria-label="Add player"
          >
            +
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="relative h-[28rem] min-w-[44rem]">
          <div className="absolute left-1/2 top-1/2 h-[15rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-[999px] border border-emerald-900/70 bg-emerald-950/25 shadow-inner">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="text-sm font-semibold text-emerald-100">Spot</div>
              <div className="mt-1 text-xs text-emerald-200/60">
                {villainInHand.filter(Boolean).length} opponent
                {villainInHand.filter(Boolean).length === 1 ? "" : "s"} in hand
              </div>
            </div>
          </div>

          {positions.map((position, index) => {
            const isHero = position === heroPosition;
            if (!isHero) villainIndex++;
            const seatVillainIndex = villainIndex;
            const stack = isHero ? heroStackBB : (villainStacks[seatVillainIndex] ?? heroStackBB);
            const inHand = isHero || (villainInHand[seatVillainIndex] ?? false);
            return (
              <div
                key={position}
                className={`absolute w-32 rounded border p-2 shadow-sm ${
                  isHero
                    ? "border-emerald-500 bg-emerald-950/70"
                    : inHand
                      ? "border-neutral-600 bg-neutral-900"
                      : "border-neutral-800 bg-neutral-950"
                }`}
                style={seatPositionStyle(index, positions.length)}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onHeroPositionChange(position)}
                    className={`rounded px-2 py-1 text-xs font-semibold ${
                      isHero
                        ? "bg-emerald-500 text-neutral-950"
                        : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                    }`}
                  >
                    {position}
                  </button>
                  {isHero ? (
                    <span className="text-xs font-semibold text-emerald-200">Hero</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onVillainInHandToggle(seatVillainIndex)}
                      className={`rounded px-2 py-1 text-xs ${
                        inHand
                          ? "bg-sky-900 text-sky-100"
                          : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"
                      }`}
                    >
                      {inHand ? "In" : "Out"}
                    </button>
                  )}
                </div>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
                    Stack BB
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={stack}
                    onChange={(e) =>
                      isHero
                        ? onHeroStackChange(toNumber(e.target.value))
                        : onVillainStackChange(seatVillainIndex, toNumber(e.target.value))
                    }
                    className="h-8 w-full rounded border border-neutral-800 bg-neutral-950 px-2 text-sm tabular-nums outline-none focus:border-emerald-600"
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="flex flex-wrap gap-1 rounded bg-neutral-950 p-1">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(toNumber(e.target.value))}
        className="h-9 w-full rounded border border-neutral-800 bg-neutral-950 px-3 text-sm tabular-nums outline-none focus:border-emerald-600"
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full rounded border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-600"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function getBeginnerRecommendation(args: {
  street: Street;
  chart: PreflopChart | undefined;
  selectedMix: ChartAction[];
  equity: EquityResult | undefined;
  simulationStatus: SimulationStatus;
  potOdds: number;
  toCallBB: number;
  actionEvs: ActionEvEstimate[];
  solverResult: SolverResult | undefined;
  solverStatus: SolverStatus;
  solverBetSizeBB: number;
  legalActions: ActionType[];
}): BeginnerRecommendation {
  if (args.street === "preflop") {
    const best = args.selectedMix.reduce<ChartAction | undefined>(
      (winner, action) => (!winner || action.frequency > winner.frequency ? action : winner),
      undefined,
    );
    if (best) {
      return {
        action: best.type,
        title: actionLabel(best),
        source: "Preflop chart",
        detail: `${pct(best.frequency)} frequency for this hand class.`,
        metric: args.chart ? `${args.chart.stackBB}bb ${args.chart.scenario}` : undefined,
      };
    }
    return {
      title: "No chart",
      source: "Not covered",
      detail: "This exact preflop setup is not covered by the shipped charts yet.",
    };
  }

  const solverActions =
    args.solverResult?.handStrategy?.inHeroRange && args.solverResult.handStrategy.actions.length
      ? args.solverResult.handStrategy.actions
      : args.solverResult?.actions;
  const solverBest = solverActions?.reduce<SolverActionResult | undefined>(
    (winner, action) => (!winner || action.frequency > winner.frequency ? action : winner),
    undefined,
  );
  if (solverBest) {
    return {
      action: solverBest.action,
      title: solverActionLabel(solverBest),
      source: "River solver",
      detail: `${pct(solverBest.frequency)} solver frequency.`,
      metric: `${signed(solverBest.evBB)}bb EV at ${fmt(args.solverBetSizeBB)}bb bet size`,
    };
  }

  if (args.toCallBB > 0 && args.equity) {
    const clearsPrice = args.equity.equity >= args.potOdds;
    return {
      action: clearsPrice ? "call" : "fold",
      title: clearsPrice ? "Call" : "Fold",
      source: "Equity check",
      detail: `Equity ${pct(args.equity.equity)} vs price ${pct(args.potOdds)}.`,
    };
  }

  const bestEv = args.actionEvs
    .filter((action) => args.legalActions.includes(action.type) && action.evBB !== undefined)
    .reduce<ActionEvEstimate | undefined>(
      (winner, action) =>
        !winner ||
        (action.evBB ?? Number.NEGATIVE_INFINITY) > (winner.evBB ?? Number.NEGATIVE_INFINITY)
          ? action
          : winner,
      undefined,
    );
  if (bestEv?.evBB !== undefined) {
    return {
      action: bestEv.type,
      title: actionLabel(bestEv),
      source: "Equity model",
      detail: "Best simple EV estimate from the current pot, bet size, and equity.",
      metric: `${signed(bestEv.evBB)}bb EV`,
    };
  }

  return {
    title: statusWord(args.simulationStatus),
    source: args.solverStatus === "running" ? "Solver running" : "Waiting",
    detail: "Enter a complete spot to get a recommendation.",
  };
}

function statusWord(status: SimulationStatus): string {
  if (status === "running") return "Running";
  if (status === "cached") return "Cached";
  if (status === "complete") return "Ready";
  if (status === "error") return "Error";
  return "Waiting";
}

function buildManualSpot(args: {
  street: Street;
  heroPosition: Position;
  effectiveStackBB: number;
  potBB: number;
  toCallBB: number;
  parsedSpot: ParsedSpot;
}): Spot | undefined {
  if (!args.parsedSpot.hero || args.parsedSpot.error) return undefined;
  return {
    handId: "manual-trainer",
    street: args.street,
    actionIndex: 0,
    heroPosition: args.heroPosition,
    effectiveStackBB: args.effectiveStackBB,
    potBB: args.potBB,
    toCallBB: args.toCallBB,
    board: args.parsedSpot.board,
    heroCards: args.parsedSpot.hero,
    priorActions: [],
  };
}

function riverSolverUnavailableReason(args: {
  street: Street;
  toCallBB: number;
  opponentsInHand: number;
  parsedSpot: ParsedSpot;
  betSizeBB: number;
}): string | undefined {
  if (args.street !== "river") return "River CFR is available on complete river spots.";
  if (args.parsedSpot.error) return args.parsedSpot.error;
  if (!args.parsedSpot.hero) return "Enter two hero cards.";
  if (args.parsedSpot.board.length !== 5) return "River CFR needs five board cards.";
  if (args.opponentsInHand !== 1) return "River CFR currently supports one opponent.";
  if (args.toCallBB > 0) return "River CFR currently supports check/bet nodes, not facing a bet.";
  if (args.betSizeBB <= 0) return "Set a positive bet size.";
  return undefined;
}

function solverStatusLabel(status: SolverStatus): string {
  if (status === "running") return "Running";
  if (status === "cached") return "Cached";
  if (status === "complete") return "Solved";
  if (status === "error") return "Error";
  return "Idle";
}

function solverActionKey(action: SolverActionResult): string {
  return `${action.action}:${action.sizeBB ?? ""}`;
}

function solverActionLabel(action: SolverActionResult): string {
  return `${ACTION_LABEL[action.action]}${action.sizeBB ? ` ${fmt(action.sizeBB)}bb` : ""}`;
}

function positionsFor(playerCount: number): readonly Position[] {
  return POSITIONS_BY_PLAYERS[playerCount] ?? ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
}

function normalizedInHand(values: readonly boolean[], count: number): boolean[] {
  const next = Array.from({ length: count }, (_, index) => values[index] ?? index === 0);
  if (next.some(Boolean)) return next;
  if (next.length > 0) next[0] = true;
  return next;
}

function seatPositionStyle(
  index: number,
  total: number,
): { left: string; top: string; transform: string } {
  const angle = -90 + (360 / total) * index;
  const radians = (angle * Math.PI) / 180;
  const x = 50 + Math.cos(radians) * 42;
  const y = 50 + Math.sin(radians) * 39;
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
  };
}

function findSpotChart(
  format: GameFormat,
  street: Street,
  effectiveStackBB: number,
  heroPosition: Position,
  aggressorPosition: Position,
  toCallBB: number,
): PreflopChart | undefined {
  if (street !== "preflop") return undefined;
  const availableStacks = unique(CHARTS.filter((c) => c.format === format).map((c) => c.stackBB));
  const stackBB = closest(availableStacks, effectiveStackBB);
  if (stackBB === undefined) return undefined;

  if (toCallBB > 0) {
    return CHARTS.find(
      (c) =>
        c.format === format &&
        c.stackBB === stackBB &&
        c.position === heroPosition &&
        c.vsPosition === aggressorPosition,
    );
  }

  const scenario = format === "mtt" && stackBB <= 10 ? "Push/fold (jam)" : "RFI";
  return CHARTS.find(
    (c) =>
      c.format === format &&
      c.stackBB === stackBB &&
      c.position === heroPosition &&
      c.scenario === scenario,
  );
}

function legalActionsFor(street: Street, toCallBB: number): ActionType[] {
  if (toCallBB > 0) return ["fold", "call", "raise", "all-in"];
  if (street === "preflop") return ["check", "raise", "all-in", "fold"];
  return ["check", "bet", "all-in"];
}

function defaultActionFor(chart: PreflopChart | undefined): ActionType {
  return chart?.actions[0]?.type ?? "check";
}

function summarizeChart(chart: PreflopChart): ActionSummary[] {
  const totals = new Map<string, ActionSummary>();
  for (const cls of HAND_CLASSES) {
    for (const action of evaluateHand(chart, cls)) {
      const key = actionKey(action);
      const previous = totals.get(key) ?? {
        key,
        type: action.type,
        sizeBB: action.sizeBB,
        combos: 0,
      };
      previous.combos += comboCount(cls) * action.frequency;
      totals.set(key, previous);
    }
  }
  return sortActions([...totals.values()]);
}

function frequencyForAction(mix: ChartAction[], type: ActionType): number {
  return mix.filter((m) => m.type === type).reduce((sum, m) => sum + m.frequency, 0);
}

function equityCacheKey(args: {
  hero: [Card, Card];
  board: Card[];
  range: string;
  opponents: number;
  iterations: number;
}): string {
  return `${EQUITY_CACHE_PREFIX}${JSON.stringify({
    hero: args.hero.map(formatCard),
    board: args.board.map(formatCard),
    range: args.range.replace(/\s+/g, " ").trim(),
    opponents: args.opponents,
    iterations: args.iterations,
  })}`;
}

function readEquityCache(key: string): EquityResult | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { result?: EquityResult };
    return parsed.result && Number.isFinite(parsed.result.equity) ? parsed.result : undefined;
  } catch {
    return undefined;
  }
}

function writeEquityCache(key: string, result: EquityResult): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), result }));
    pruneEquityCache();
  } catch {
    // Cache writes are best-effort; quota pressure should never break training.
  }
}

function pruneEquityCache(): void {
  const entries = Object.keys(localStorage)
    .filter((key) => key.startsWith(EQUITY_CACHE_PREFIX))
    .map((key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as { savedAt?: number };
        return { key, savedAt: parsed.savedAt ?? 0 };
      } catch {
        return { key, savedAt: 0 };
      }
    })
    .sort((a, b) => b.savedAt - a.savedAt);

  for (const entry of entries.slice(MAX_CACHED_SIMULATIONS)) {
    localStorage.removeItem(entry.key);
  }
}

function estimateActionEvs(args: {
  equity: number | undefined;
  potBB: number;
  toCallBB: number;
  aggressiveSizeBB: number;
  allInSizeBB: number;
  foldEquity: number;
}): ActionEvEstimate[] {
  const showdown = args.equity;
  const foldEquity = clamp(args.foldEquity, 0, 1);
  const aggressiveSize = Math.min(Math.max(args.aggressiveSizeBB, 0), args.allInSizeBB);
  const allInSize = Math.max(args.allInSizeBB, 0);
  return ACTION_CHOICES.map((type) => {
    if (showdown === undefined) {
      return { type, evBB: undefined, note: "Needs a valid simulated equity result." };
    }
    if (type === "fold") {
      return { type, evBB: 0, note: "Fold gives up the pot and invests no more chips." };
    }
    if (type === "check") {
      return {
        type,
        evBB: showdown * args.potBB,
        note: "Showdown-only estimate; assumes no future betting.",
      };
    }
    if (type === "call") {
      if (args.toCallBB <= 0) {
        return { type, evBB: undefined, note: "No call price is set." };
      }
      return {
        type,
        evBB: showdown * (args.potBB + args.toCallBB) - args.toCallBB,
        note: "Closing-action call estimate from simulated equity.",
      };
    }
    const size = type === "all-in" ? allInSize : aggressiveSize;
    if (size <= 0) return { type, evBB: undefined, note: "Set a positive bet/raise size." };
    return {
      type,
      evBB:
        foldEquity * args.potBB + (1 - foldEquity) * (showdown * (args.potBB + size * 2) - size),
      note:
        type === "all-in"
          ? "Assumes fold equity, then one caller to effective all-in."
          : "Assumes fold equity, then one caller and no future betting.",
    };
  });
}

function parseSpotCards(
  heroCardTexts: [string, string],
  boardCardTexts: [string, string, string, string, string],
  street: Street,
): ParsedSpot {
  const cards: Card[] = [];
  const seen = new Set<string>();

  try {
    const hero: [Card, Card] = [parseCard(heroCardTexts[0]), parseCard(heroCardTexts[1])];
    for (const card of hero) {
      const key = formatCard(card);
      if (seen.has(key)) return { board: [], error: `Duplicate card ${key}.` };
      seen.add(key);
      cards.push(card);
    }

    const board: Card[] = [];
    for (const raw of boardCardTexts.slice(0, BOARD_SLOTS[street])) {
      if (raw.trim() === "")
        return {
          hero,
          board,
          error: `${titleCase(street)} needs ${BOARD_SLOTS[street]} board cards.`,
        };
      const card = parseCard(raw);
      const key = formatCard(card);
      if (seen.has(key)) return { hero, board, error: `Duplicate card ${key}.` };
      seen.add(key);
      cards.push(card);
      board.push(card);
    }
    return { hero, board };
  } catch (err) {
    return { board: [], error: err instanceof Error ? err.message : "Invalid card input." };
  }
}

function buildVillainCombos(notation: string, blockers: Card[]): RangeCombos | { error: string } {
  try {
    const weights = compileRange(notation);
    const blocked = new Set(blockers.map(formatCard));
    const unique = new Set<string>();
    const combos: Array<[Card, Card]> = [];

    for (const [cls, weight] of Object.entries(weights)) {
      if (weight <= 0) continue;
      const repeats = Math.max(1, Math.round(weight * 10));
      for (const combo of combosForClass(cls)) {
        if (blocked.has(formatCard(combo[0])) || blocked.has(formatCard(combo[1]))) continue;
        const key = comboKey(combo);
        unique.add(key);
        for (let i = 0; i < repeats; i++) combos.push(combo);
      }
    }

    if (combos.length === 0) return { error: "Villain range has no unblocked combos." };
    return { combos, uniqueCombos: unique.size };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid range notation." };
  }
}

function combosForClass(cls: string): Array<[Card, Card]> {
  const r1 = rankFromChar(cls[0]);
  const r2 = rankFromChar(cls[1]);
  if (!r1 || !r2) return [];

  if (cls.length === 2) {
    const pairs: Array<[Card, Card]> = [];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        pairs.push([
          { rank: r1, suit: SUITS[i] ?? Suit.Spades },
          { rank: r1, suit: SUITS[j] ?? Suit.Hearts },
        ]);
      }
    }
    return pairs;
  }

  const suited = cls.endsWith("s");
  const combos: Array<[Card, Card]> = [];
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (suited && s1 !== s2) continue;
      if (!suited && s1 === s2) continue;
      combos.push([
        { rank: r1, suit: s1 },
        { rank: r2, suit: s2 },
      ]);
    }
  }
  return combos;
}

function handClassFromCards([a, b]: [Card, Card]): string {
  const av = rankOrder(a.rank);
  const bv = rankOrder(b.rank);
  const [hi, lo] = av >= bv ? [a, b] : [b, a];
  if (hi.rank === lo.rank) return `${hi.rank}${lo.rank}`;
  return `${hi.rank}${lo.rank}${hi.suit === lo.suit ? "s" : "o"}`;
}

function representativeCards(cls: string): [string, string] {
  const r1 = cls[0] ?? "A";
  const r2 = cls[1] ?? "A";
  if (cls.length === 2) return [`${r1}s`, `${r2}d`];
  if (cls.endsWith("s")) return [`${r1}s`, `${r2}s`];
  return [`${r1}s`, `${r2}d`];
}

function rankFromChar(ch: string | undefined): Rank | undefined {
  return Object.values(Rank).find((rank) => rank === ch);
}

function rankOrder(rank: Rank): number {
  return "23456789TJQKA".indexOf(rank);
}

function replaceTupleValue(
  prev: [string, string, string, string, string],
  index: number,
  value: string,
): [string, string, string, string, string] {
  const next: [string, string, string, string, string] = [...prev];
  next[index] = value;
  return next;
}

function updateVillainStack(
  setVillainStacks: React.Dispatch<React.SetStateAction<number[]>>,
  index: number,
  value: number,
) {
  setVillainStacks((prev) => prev.map((stack, i) => (i === index ? value : stack)));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function closest(values: number[], target: number): number | undefined {
  return values.reduce<number | undefined>((best, value) => {
    if (best === undefined) return value;
    return Math.abs(value - target) < Math.abs(best - target) ? value : best;
  }, undefined);
}

function scenarioIndex(scenario: string): number {
  const index = SCENARIO_ORDER.indexOf(scenario);
  return index === -1 ? SCENARIO_ORDER.length : index;
}

function chartTitle(chart: PreflopChart): string {
  const format = chart.format === "cash" ? "Cash" : "Tournament";
  return `${format} ${chart.stackBB}bb ${chart.scenario} - ${chartTabLabel(chart)}`;
}

function chartTabLabel(chart: PreflopChart): string {
  return chart.vsPosition ? `${chart.position} vs ${chart.vsPosition}` : chart.position;
}

function actionKey(action: ActionLike): string {
  return `${action.type}:${action.sizeBB ?? ""}`;
}

function actionLabel(action: ActionLike): string {
  return `${ACTION_LABEL[action.type]}${action.sizeBB ? ` ${action.sizeBB}bb` : ""}`;
}

function mixLabel(mix: ChartAction[]): string {
  return mix.map((a) => `${actionLabel(a)} ${pct(a.frequency)}`).join(" / ");
}

function mixBackground(mix: ChartAction[]): string {
  let cursor = 0;
  const stops: string[] = [];
  for (const action of mix) {
    const start = cursor;
    const end = cursor + action.frequency * 100;
    stops.push(`${ACTION_COLOR[action.type]} ${start}% ${end}%`);
    cursor = end;
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function segmentClass(active: boolean): string {
  return `min-h-8 rounded px-3 py-1.5 text-sm font-medium ${
    active
      ? "bg-neutral-100 text-neutral-950"
      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
  }`;
}

function pct(value: number): string {
  const digits = value > 0 && value < 0.1 ? 1 : 0;
  return `${(value * 100).toFixed(digits)}%`;
}

function fmt(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt(value)}`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function comboKey([a, b]: [Card, Card]): string {
  return [formatCard(a), formatCard(b)].sort().join("");
}

function randomClass(): string {
  let roll = Math.random() * TOTAL_COMBOS;
  for (const cls of HAND_CLASSES) {
    roll -= comboCount(cls);
    if (roll <= 0) return cls;
  }
  return FALLBACK_HAND_CLASS;
}

function getFallbackHandClass(): string {
  const cls = HAND_CLASSES[0];
  if (cls === undefined) throw new Error("trainer requires starting hand classes");
  return cls;
}
