import type { Action, Card, Grade, GradeAction, Hand, Street } from "@poker/shared";
import { useMemo, useState } from "react";
import { formatAmount } from "../lib/format.js";
import { PlayingCard } from "./PlayingCard.js";

interface ReplayStep {
  index: number;
  street: Street;
  actionIndex: number;
  action: Action;
  board: Card[];
  state: ReplayState;
}

interface ReplayState {
  committed: Map<string, number>;
  streetIn: Map<string, number>;
  folded: Set<string>;
  startingStack: Map<string, number>;
}

const VOLUNTARY = new Set<Action["type"]>(["fold", "check", "call", "bet", "raise", "all-in"]);

export function HandReplay({
  hand,
  grades,
  analysisPending = false,
}: {
  hand: Hand;
  grades?: Grade[];
  analysisPending?: boolean;
}) {
  const steps = useMemo(() => buildReplaySteps(hand), [hand]);
  const firstDecisionIndex = steps.find(
    (s) => s.action.actor === hand.hero && VOLUNTARY.has(s.action.type),
  )?.index;
  const [stepIndex, setStepIndex] = useState(firstDecisionIndex ?? 0);
  const step = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];
  const grade = step ? gradeForStep(grades, step) : undefined;
  const heroDecisionSteps = steps.filter(
    (s) => s.action.actor === hand.hero && VOLUNTARY.has(s.action.type),
  );
  const tableSizing = portraitTableSizing(hand.seats.length);

  if (steps.length === 0) {
    return (
      <section className="rounded border border-neutral-800 p-4 text-sm text-neutral-500">
        No replayable actions were parsed for this hand.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Hand replay</h2>
          <div className="mt-1 text-sm text-neutral-400">
            Step through the imported hand and review Hero's decision points.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex <= 0}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:text-neutral-600"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
            disabled={stepIndex >= steps.length - 1}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:text-neutral-600"
          >
            Next
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)] lg:items-start">
        <div className="rounded border border-neutral-800 bg-neutral-950/40 p-3 sm:p-4">
          <div className={`relative mx-auto w-full ${tableSizing.frame}`}>
            <div
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[999px] border border-emerald-900/70 bg-emerald-950/25 shadow-inner ${tableSizing.felt}`}
            >
              <div
                className={`absolute left-1/2 top-[46%] w-full -translate-x-1/2 -translate-y-1/2 px-3 text-center ${tableSizing.center}`}
              >
                <div className="text-xs uppercase tracking-wide text-emerald-200/70">
                  {step?.street}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {step?.board.length ? (
                    step.board.map((card, index) => (
                      <PlayingCard
                        key={`${card.rank}${card.suit}-${index}`}
                        card={card}
                        size="md"
                      />
                    ))
                  ) : (
                    <span className="text-sm text-emerald-200/50">Preflop</span>
                  )}
                </div>
                <div className="mt-3 text-sm font-semibold text-emerald-100">
                  Pot {formatAmount(step ? potOf(step.state) : 0, hand.currency)}
                </div>
              </div>
            </div>

            {hand.seats.map((seat, index) => (
              <ReplaySeat
                key={seat.seat}
                hand={hand}
                seat={seat}
                state={step?.state}
                currentActor={step?.action.actor}
                index={index}
                total={hand.seats.length}
              />
            ))}
          </div>
        </div>

        <aside className="rounded border border-neutral-800 p-4 lg:sticky lg:top-4">
          {step && (
            <>
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                Step {step.index + 1} of {steps.length}
              </div>
              <div className="mt-2 text-xl font-semibold">
                {step.action.actor === hand.hero
                  ? "Hero acts"
                  : `${playerLabel(step.action.actor, hand)} acts`}
              </div>
              <div className="mt-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                <span
                  className={
                    step.action.actor === hand.hero ? "text-emerald-300" : "text-neutral-200"
                  }
                >
                  {playerLabel(step.action.actor, hand)}
                </span>{" "}
                {actionText(step.action, hand.currency)}
              </div>

              {step.action.actor === hand.hero ? (
                <RecommendationCard
                  grade={grade}
                  action={step.action}
                  analysisPending={analysisPending}
                />
              ) : (
                <div className="mt-4 rounded border border-neutral-800 px-3 py-2 text-sm text-neutral-400">
                  Waiting for Hero's next decision.
                </div>
              )}

              <input
                type="range"
                min={0}
                max={steps.length - 1}
                value={stepIndex}
                onChange={(event) => setStepIndex(Number(event.target.value))}
                className="mt-5 w-full"
                aria-label="Replay step"
              />
            </>
          )}
        </aside>
      </div>

      {heroDecisionSteps.length > 0 && (
        <div className="rounded border border-neutral-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Hero decisions
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {heroDecisionSteps.map((heroStep) => (
              <HeroDecisionJump
                key={`${heroStep.street}-${heroStep.actionIndex}`}
                step={heroStep}
                grade={gradeForStep(grades, heroStep)}
                hand={hand}
                selected={heroStep.index === stepIndex}
                onSelect={() => setStepIndex(heroStep.index)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ReplaySeat({
  hand,
  seat,
  state,
  currentActor,
  index,
  total,
}: {
  hand: Hand;
  seat: Hand["seats"][number];
  state: ReplayState | undefined;
  currentActor: string | undefined;
  index: number;
  total: number;
}) {
  const isHero = seat.player === hand.hero;
  const isCurrent = seat.player === currentActor;
  const folded = state?.folded.has(seat.player) ?? false;
  const remaining = state
    ? Math.max(
        0,
        (state.startingStack.get(seat.player) ?? seat.stack) - committedOf(state, seat.player),
      )
    : seat.stack;
  const streetIn = state ? streetInOf(state, seat.player) : 0;

  return (
    <div
      className={`absolute w-32 rounded border p-2 shadow-sm sm:w-36 ${
        isCurrent
          ? "border-sky-400 bg-sky-950/70"
          : isHero
            ? "border-emerald-500 bg-emerald-950/70"
            : folded
              ? "border-neutral-800 bg-neutral-950 text-neutral-600"
              : "border-neutral-700 bg-neutral-900"
      }`}
      style={seatPositionStyle(index, total)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-neutral-950 px-2 py-1 text-xs font-semibold text-neutral-200">
          {seat.position ?? seat.seat}
        </span>
        <span
          className={`text-xs font-semibold ${isHero ? "text-emerald-200" : "text-neutral-300"}`}
        >
          {isHero ? "Hero" : folded ? "Folded" : "Live"}
        </span>
      </div>
      <div className="mt-2 truncate text-sm font-medium">{seat.player}</div>
      <div className="mt-1 text-xs tabular-nums text-neutral-400">
        Stack {formatAmount(remaining, hand.currency)}
      </div>
      {streetIn > 0 && (
        <div className="mt-1 w-fit rounded bg-neutral-950 px-2 py-0.5 text-xs tabular-nums text-amber-300">
          In {formatAmount(streetIn, hand.currency)}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({
  grade,
  action,
  analysisPending,
}: {
  grade: Grade | undefined;
  action: Action;
  analysisPending: boolean;
}) {
  if (!grade) {
    return (
      <div className="mt-4 rounded border border-neutral-800 px-3 py-2 text-sm text-neutral-400">
        {analysisPending
          ? "Analyzing recommendation..."
          : "Recommendation unavailable for this Hero action."}
      </div>
    );
  }

  const recommended = recommendedAction(grade);
  return (
    <div className="mt-4 rounded border border-emerald-800 bg-emerald-950/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
        Play recommendation
      </div>
      <div className="mt-2 text-lg font-semibold">
        {recommended ? gradeActionLabel(recommended) : "No action"}
      </div>
      <div className="mt-1 text-sm text-neutral-300">
        You chose <span className="font-medium text-neutral-100">{action.type}</span>.
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <MiniMetric label="Verdict" value={grade.verdict} />
        <MiniMetric label="Loss" value={`${grade.evLossBB.toFixed(2)}bb`} />
      </div>
      <div className="mt-3 rounded border border-neutral-800 bg-neutral-950/70 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Why this play
        </div>
        <p className="mt-1 text-sm leading-6 text-neutral-300">
          {explainRecommendation(grade, recommended, action)}
        </p>
      </div>
      {grade.notes && <div className="mt-3 text-xs text-neutral-500">{grade.notes}</div>}
    </div>
  );
}

function HeroDecisionJump({
  step,
  grade,
  hand,
  selected,
  onSelect,
}: {
  step: ReplayStep;
  grade: Grade | undefined;
  hand: Hand;
  selected: boolean;
  onSelect: () => void;
}) {
  const recommended = grade ? recommendedAction(grade) : undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded border px-3 py-2 text-left text-sm hover:bg-neutral-900 ${
        selected ? "border-emerald-600 bg-emerald-950/20" : "border-neutral-800"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-neutral-200">{step.street}</span>
        <span className="text-xs text-neutral-500">step {step.index + 1}</span>
      </div>
      <div className="mt-1 text-neutral-400">Hero {actionText(step.action, hand.currency)}</div>
      <div className="mt-1 text-emerald-300">
        Rec: {recommended ? gradeActionLabel(recommended) : "n/a"}
      </div>
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 font-semibold capitalize tabular-nums">{value}</div>
    </div>
  );
}

function buildReplaySteps(hand: Hand): ReplayStep[] {
  const state: ReplayState = {
    committed: new Map(),
    streetIn: new Map(),
    folded: new Set(),
    startingStack: new Map(hand.seats.map((seat) => [seat.player, seat.stack])),
  };
  const steps: ReplayStep[] = [];

  for (const street of hand.streets) {
    state.streetIn = new Map();
    for (let actionIndex = 0; actionIndex < street.actions.length; actionIndex++) {
      const action = street.actions[actionIndex];
      if (!action) continue;
      steps.push({
        index: steps.length,
        street: street.street,
        actionIndex,
        action,
        board: street.board,
        state: cloneState(state),
      });
      applyAction(state, action);
    }
  }

  return steps;
}

function gradeForStep(grades: Grade[] | undefined, step: ReplayStep): Grade | undefined {
  return grades?.find(
    (grade) =>
      grade.decision.spot.street === step.street &&
      grade.decision.spot.actionIndex === step.actionIndex,
  );
}

function recommendedAction(grade: Grade): GradeAction | undefined {
  if (grade.actions.length === 0) return undefined;
  if (grade.source === "preflop-chart" || grade.source === "hu-cfr") {
    return grade.actions.reduce((best, action) =>
      (action.frequency ?? 0) > (best.frequency ?? 0) ? action : best,
    );
  }
  return grade.actions.reduce((best, action) => (action.evBB > best.evBB ? action : best));
}

function explainRecommendation(
  grade: Grade,
  recommended: GradeAction | undefined,
  action: Action,
): string {
  if (!recommended) {
    return "The analyzer did not return enough candidate actions to explain this spot.";
  }

  const { spot } = grade.decision;
  const chosen = grade.actions.find((a) => a.chosen);
  const source = recommendationSourceText(grade, recommended);
  const price = priceText(spot.potBB, spot.toCallBB);
  const comparison =
    grade.evLossBB > 0.05
      ? `Hero's ${action.type} gives up about ${grade.evLossBB.toFixed(2)}bb versus that line.`
      : `Hero's ${action.type} is close to the preferred line in this model.`;
  const ev =
    chosen && recommended.evBB !== chosen.evBB
      ? `Modeled EV: ${gradeActionLabel(recommended)} ${recommended.evBB.toFixed(2)}bb vs ${action.type} ${chosen.evBB.toFixed(2)}bb.`
      : `Modeled EV for the preferred line is ${recommended.evBB.toFixed(2)}bb.`;

  return `${source} ${price} ${ev} ${comparison}`;
}

function recommendationSourceText(grade: Grade, recommended: GradeAction): string {
  const { spot } = grade.decision;
  const frequency =
    recommended.frequency !== undefined ? ` at ${pct(recommended.frequency)} frequency` : "";
  const label = gradeActionLabel(recommended);

  if (grade.source === "preflop-chart") {
    return `${label} is the chart's preferred play from ${spot.heroPosition}${frequency} at ${spot.effectiveStackBB.toFixed(0)}bb effective.`;
  }
  if (grade.source === "hu-cfr") {
    return `${label} is preferred by the heads-up postflop solve${frequency}; it keeps the range balanced while retaining the most EV at this node.`;
  }
  if (grade.source === "multiway-rollout") {
    return `${label} has the best rollout EV against the modeled multiway ranges. Multiway spots are approximate, so treat this as a strong study signal rather than a solved database node.`;
  }
  if (grade.source === "rollout-ev") {
    return `${label} has the best rollout EV against the modeled villain range.`;
  }
  return `${label} is the best available action in the current analyzer output.`;
}

function priceText(potBB: number, toCallBB: number): string {
  if (toCallBB <= 0) {
    return `With no bet to call and a ${potBB.toFixed(1)}bb pot, the choice is about realizing equity versus applying pressure.`;
  }
  const price = toCallBB / Math.max(potBB + toCallBB, 1e-9);
  return `Calling costs ${toCallBB.toFixed(1)}bb into a ${potBB.toFixed(1)}bb pot, so the direct price is ${pct(price)}.`;
}

function cloneState(state: ReplayState): ReplayState {
  return {
    committed: new Map(state.committed),
    streetIn: new Map(state.streetIn),
    folded: new Set(state.folded),
    startingStack: new Map(state.startingStack),
  };
}

function applyAction(state: ReplayState, action: Action): void {
  const committed = committedOf(state, action.actor);
  const streetIn = streetInOf(state, action.actor);
  switch (action.type) {
    case "fold":
      state.folded.add(action.actor);
      return;
    case "check":
      return;
    case "post-ante":
      state.committed.set(action.actor, committed + (action.amount ?? 0));
      return;
    case "post-sb":
    case "post-bb":
    case "bet":
    case "raise": {
      const to = action.amount ?? streetIn;
      const increment = Math.max(0, to - streetIn);
      state.committed.set(action.actor, committed + increment);
      state.streetIn.set(action.actor, to);
      return;
    }
    case "call": {
      const increment = action.amount ?? 0;
      state.committed.set(action.actor, committed + increment);
      state.streetIn.set(action.actor, streetIn + increment);
      return;
    }
    case "all-in": {
      const remaining = Math.max(0, (state.startingStack.get(action.actor) ?? 0) - committed);
      state.committed.set(action.actor, committed + remaining);
      state.streetIn.set(action.actor, streetIn + remaining);
      return;
    }
  }
}

function committedOf(state: ReplayState, player: string): number {
  return state.committed.get(player) ?? 0;
}

function streetInOf(state: ReplayState, player: string): number {
  return state.streetIn.get(player) ?? 0;
}

function potOf(state: ReplayState): number {
  let total = 0;
  for (const value of state.committed.values()) total += value;
  return total;
}

function seatPositionStyle(
  index: number,
  total: number,
): { left: string; top: string; transform: string } {
  const layout = portraitSeatLayout(total);
  const point = layout[index] ?? layout[layout.length - 1] ?? { x: 50, y: 50 };
  return {
    left: `${point.x}%`,
    top: `${point.y}%`,
    transform: "translate(-50%, -50%)",
  };
}

function portraitSeatLayout(total: number): Array<{ x: number; y: number }> {
  switch (total) {
    case 2:
      return [
        { x: 50, y: 7 },
        { x: 50, y: 88 },
      ];
    case 3:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 81 },
        { x: 18, y: 81 },
      ];
    case 4:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 50 },
        { x: 50, y: 90 },
        { x: 18, y: 50 },
      ];
    case 5:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 32 },
        { x: 82, y: 70 },
        { x: 50, y: 90 },
        { x: 18, y: 50 },
      ];
    case 6:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 27 },
        { x: 82, y: 68 },
        { x: 50, y: 90 },
        { x: 18, y: 68 },
        { x: 18, y: 27 },
      ];
    case 7:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 23 },
        { x: 82, y: 50 },
        { x: 82, y: 77 },
        { x: 50, y: 91 },
        { x: 18, y: 72 },
        { x: 18, y: 28 },
      ];
    case 8:
      return [
        { x: 50, y: 7 },
        { x: 82, y: 20 },
        { x: 82, y: 44 },
        { x: 82, y: 68 },
        { x: 50, y: 91 },
        { x: 18, y: 68 },
        { x: 18, y: 44 },
        { x: 18, y: 20 },
      ];
    default:
      return [
        { x: 50, y: 6 },
        { x: 82, y: 19 },
        { x: 82, y: 38 },
        { x: 82, y: 58 },
        { x: 82, y: 78 },
        { x: 50, y: 92 },
        { x: 18, y: 78 },
        { x: 18, y: 58 },
        { x: 18, y: 38 },
      ];
  }
}

function portraitTableSizing(total: number): {
  frame: string;
  felt: string;
  center: string;
} {
  if (total <= 3) {
    return {
      frame: "h-[29rem] max-w-[24rem] sm:h-[32rem] sm:max-w-[26rem]",
      felt: "h-[18rem] w-[13rem] sm:h-[20rem] sm:w-[15rem]",
      center: "max-w-[11.5rem] sm:max-w-[13rem]",
    };
  }

  if (total <= 6) {
    return {
      frame: "h-[36rem] max-w-[25rem] sm:h-[40rem] sm:max-w-[28rem]",
      felt: "h-[22rem] w-[14rem] sm:h-[25rem] sm:w-[16.5rem]",
      center: "max-w-[12rem] sm:max-w-[14rem]",
    };
  }

  return {
    frame: "h-[44rem] max-w-[26rem] sm:h-[46rem]",
    felt: "h-[26rem] w-[14.5rem] sm:h-[29rem] sm:w-[18rem]",
    center: "max-w-[13rem] sm:max-w-[15rem]",
  };
}

function playerLabel(player: string, hand: Hand): string {
  return player === hand.hero ? "Hero" : player;
}

function actionText(action: Action, currency: string): string {
  const amount = action.amount !== undefined ? ` ${formatAmount(action.amount, currency)}` : "";
  if (action.type === "post-sb") return `posts SB${amount}`;
  if (action.type === "post-bb") return `posts BB${amount}`;
  if (action.type === "post-ante") return `posts ante${amount}`;
  if (action.type === "all-in") return `moves all-in${amount}`;
  if (action.type === "raise") return `raises to${amount}`;
  return `${action.type}s${amount}`;
}

function gradeActionLabel(action: GradeAction): string {
  const base = action.type === "all-in" ? "All-in" : titleCase(action.type);
  return action.sizeBB !== undefined ? `${base} ${action.sizeBB.toFixed(1)}bb` : base;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
