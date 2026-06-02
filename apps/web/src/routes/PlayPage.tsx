import type { CoachAdvice, GameView, LegalAction, PlayerView } from "@poker/game";
import type { Card, Grade } from "@poker/shared";
import { useRef, useState } from "react";
import { PlayingCard } from "../components/PlayingCard.js";
import { type GameActionBody, api } from "../lib/api.js";

export function PlayPage() {
  const [game, setGame] = useState<{ id: string; view: GameView } | null>(null);
  const [setup, setSetup] = useState({ seats: 6, difficulty: 0.7, rakePercent: 0 });
  const [starting, setStarting] = useState(false);

  if (!game) {
    return (
      <div className="max-w-md space-y-5">
        <h1 className="text-lg font-semibold">Play vs AI</h1>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-400">Players: {setup.seats}</span>
          <input
            type="range"
            min={2}
            max={9}
            value={setup.seats}
            onChange={(e) => setSetup({ ...setup, seats: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-400">
            AI difficulty: {difficultyLabel(setup.difficulty)} ({setup.difficulty.toFixed(2)})
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={setup.difficulty}
            onChange={(e) => setSetup({ ...setup, difficulty: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-400">Rake</span>
          <select
            value={setup.rakePercent}
            onChange={(e) => setSetup({ ...setup, rakePercent: Number(e.target.value) })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            <option value={0}>None — pure GTO study</option>
            <option value={0.05}>5% (capped 3bb)</option>
            <option value={0.1}>10% (capped 5bb)</option>
          </select>
        </label>
        <button
          type="button"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            try {
              const cap = setup.rakePercent === 0.1 ? 10 : setup.rakePercent === 0.05 ? 6 : 0;
              const r = await api.createGame({
                seats: setup.seats,
                difficulty: setup.difficulty,
                rakePercent: setup.rakePercent,
                rakeCap: cap,
              });
              setGame({ id: r.id, view: r.view });
            } finally {
              setStarting(false);
            }
          }}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {starting ? "Dealing…" : "Deal in"}
        </button>
        <p className="text-xs text-neutral-600">
          100bb cash, blinds 1/2. Opponent cards stay hidden until showdown. Press Hint any time for
          the full GTO breakdown.
        </p>
      </div>
    );
  }

  return <Table game={game} setGame={setGame} />;
}

function Table({
  game,
  setGame,
}: {
  game: { id: string; view: GameView };
  setGame: (g: { id: string; view: GameView }) => void;
}) {
  const [hint, setHint] = useState<CoachAdvice | null>(null);
  const [review, setReview] = useState<Grade[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<number[]>([0]);
  const recordedHand = useRef(-1);
  const v = game.view;

  function recordResult(view: GameView) {
    if (view.phase === "complete" && view.result && recordedHand.current !== view.handNumber) {
      recordedHand.current = view.handNumber;
      const net = view.result.net[view.viewerSeat] ?? 0;
      setChips((prev) => [...prev, (prev[prev.length - 1] ?? 0) + net]);
    }
  }
  const hero = v.players[v.viewerSeat]!;
  const myTurn = v.toAct === v.viewerSeat && v.phase !== "complete";
  const toCall = v.currentBet - hero.committedThisStreet;
  const spotKey = `${v.handNumber}-${v.street}-${v.players.reduce((s, p) => s + p.committedThisStreet, 0)}`;

  async function act(body: GameActionBody) {
    setBusy(true);
    setHint(null);
    try {
      const r = await api.gameAction(game.id, body);
      setGame({ id: game.id, view: r.view });
      recordResult(r.view);
    } finally {
      setBusy(false);
    }
  }

  async function nextHand() {
    setBusy(true);
    setReview(null);
    setHint(null);
    try {
      const r = await api.gameNext(game.id);
      setGame({ id: game.id, view: r.view });
      recordResult(r.view);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Hand #{v.handNumber}</h1>
        <Sparkline data={chips} />
        <span className="text-sm text-neutral-500">
          blinds {v.smallBlind}/{v.bigBlind} · pot {v.pot}
        </span>
      </div>

      {/* Board + pot */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-6 flex flex-col items-center gap-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {v.street} · pot {v.pot} ({(v.pot / v.bigBlind).toFixed(1)}bb)
        </div>
        <div className="flex gap-2 min-h-[2.5rem] items-center">
          {v.board.length === 0 ? (
            <span className="text-neutral-700 text-sm">— preflop —</span>
          ) : (
            v.board.map((c, i) => (
              <PlayingCard key={`${c.rank}${c.suit}-${i}`} card={c} size="lg" />
            ))
          )}
        </div>
      </div>

      {/* Seats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {v.players.map((p) => (
          <SeatCard
            key={p.seat}
            p={p}
            isTurn={v.toAct === p.seat && v.phase !== "complete"}
            isHero={p.seat === v.viewerSeat}
            net={v.result?.net?.[p.seat]}
          />
        ))}
      </div>

      {/* Result */}
      {v.phase === "complete" && v.result && (
        <div className="rounded border border-neutral-800 p-3 text-sm space-y-1">
          {v.result.pots.map((pot) => (
            <div key={`${pot.winners.join(",")}:${pot.amount}`}>
              {pot.winners.map((w) => v.players[w]?.name).join(", ")} wins {pot.amount}
              {pot.description ? ` with ${pot.description}` : ""}
            </div>
          ))}
          <div
            className={(v.result.net[v.viewerSeat] ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}
          >
            You {(v.result.net[v.viewerSeat] ?? 0) >= 0 ? "won" : "lost"}{" "}
            {Math.abs(v.result.net[v.viewerSeat] ?? 0)} chips this hand.
          </div>
          {v.result.rake > 0 && (
            <div className="text-xs text-neutral-500">Rake: {v.result.rake} chips</div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={nextHand}
              disabled={busy}
              className="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
            >
              Next hand
            </button>
            <button
              type="button"
              onClick={async () => setReview((await api.gameReview(game.id)).grades)}
              className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
            >
              Review my play
            </button>
          </div>
        </div>
      )}

      {/* Action controls */}
      {myTurn && (
        <ActionControls
          key={spotKey}
          legal={v.legal}
          toCall={toCall}
          pot={v.pot}
          currentBet={v.currentBet}
          bb={v.bigBlind}
          busy={busy}
          onAct={act}
          onHint={async () => setHint((await api.gameHint(game.id)).advice)}
        />
      )}

      {hint && <CoachPanel advice={hint} onClose={() => setHint(null)} />}
      {review && <ReviewPanel grades={review} />}
    </div>
  );
}

function SeatCard({
  p,
  isTurn,
  isHero,
  net,
}: {
  p: PlayerView;
  isTurn: boolean;
  isHero: boolean;
  net?: number;
}) {
  return (
    <div
      className={`rounded border p-2 transition-all duration-200 ${isTurn ? "border-emerald-600 bg-emerald-950/30 ring-1 ring-emerald-700/40" : "border-neutral-800"} ${p.status === "folded" ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {p.isButton && (
            <span className="mr-1 rounded bg-neutral-200 px-1 text-[10px] text-neutral-900">D</span>
          )}
          {isHero ? "You" : p.name}
        </span>
        <span className="tabular-nums text-xs text-neutral-400">{p.stack}</span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {p.holeCards ? (
          p.holeCards.map((c: Card, i) => (
            <PlayingCard key={`${c.rank}${c.suit}-${i}`} card={c} size="sm" />
          ))
        ) : p.status === "folded" ? (
          <span className="text-[10px] text-neutral-600">folded</span>
        ) : (
          <>
            <CardBack />
            <CardBack />
          </>
        )}
        {p.status === "all-in" && <span className="ml-1 text-[10px] text-amber-400">ALL-IN</span>}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
        <span>{p.committedThisStreet > 0 ? `bet ${p.committedThisStreet}` : ""}</span>
        {net !== undefined && (
          <span className={net >= 0 ? "text-emerald-500" : "text-red-500"}>
            {net >= 0 ? "+" : ""}
            {net}
          </span>
        )}
      </div>
    </div>
  );
}

function CardBack() {
  return <span className="inline-block h-7 w-5 rounded border border-sky-900 bg-sky-950" />;
}

function ActionControls({
  legal,
  toCall,
  pot,
  currentBet,
  bb,
  busy,
  onAct,
  onHint,
}: {
  legal: LegalAction[];
  toCall: number;
  pot: number;
  currentBet: number;
  bb: number;
  busy: boolean;
  onAct: (b: GameActionBody) => void;
  onHint: () => void;
}) {
  const raiseOpt = legal.find((l) => l.type === "bet" || l.type === "raise");
  const [amount, setAmount] = useState(raiseOpt?.min ?? 0);

  const clamp = (x: number) =>
    Math.round(Math.max(raiseOpt?.min ?? 0, Math.min(raiseOpt?.max ?? 0, x)));
  // A "fraction of pot" raise: add that fraction of the post-call pot on top of the call.
  const preset = (frac: number) => clamp(currentBet + frac * (pot + toCall));
  const presets: Array<{ label: string; to: number }> = raiseOpt
    ? [
        { label: "½", to: preset(0.5) },
        { label: "¾", to: preset(0.75) },
        { label: "Pot", to: preset(1) },
        { label: "All-in", to: raiseOpt.max ?? 0 },
      ]
    : [];

  return (
    <div className="rounded border border-neutral-800 p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {legal.some((l) => l.type === "fold") && (
          <Btn onClick={() => onAct({ type: "fold" })} busy={busy} variant="danger">
            Fold
          </Btn>
        )}
        {legal.some((l) => l.type === "check") && (
          <Btn onClick={() => onAct({ type: "check" })} busy={busy}>
            Check
          </Btn>
        )}
        {legal.some((l) => l.type === "call") && (
          <Btn onClick={() => onAct({ type: "call" })} busy={busy}>
            Call {toCall} ({(toCall / bb).toFixed(1)}bb)
          </Btn>
        )}
        <Btn onClick={onHint} busy={busy} variant="hint">
          💡 Hint
        </Btn>
      </div>

      {raiseOpt && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setAmount(p.to)}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${amount === p.to ? "bg-neutral-700 text-white" : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={raiseOpt.min}
              max={raiseOpt.max}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="flex-1 accent-emerald-600"
            />
            <span className="w-24 text-right text-sm tabular-nums">
              {amount} ({(amount / bb).toFixed(1)}bb)
            </span>
            <Btn
              onClick={() => onAct({ type: raiseOpt.type, amount })}
              busy={busy}
              variant="primary"
            >
              {raiseOpt.type === "bet" ? "Bet" : "Raise"} to {amount}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  busy,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  variant?: "default" | "primary" | "danger" | "hint";
}) {
  const cls = {
    default: "border border-neutral-700 hover:bg-neutral-800",
    primary: "bg-emerald-700 hover:bg-emerald-600",
    danger: "border border-red-800 text-red-300 hover:bg-red-950",
    hint: "border border-sky-800 text-sky-300 hover:bg-sky-950",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function CoachPanel({
  advice,
  onClose,
}: { advice: CoachAdvice; onClose: () => void }) {
  const best = advice.actions.reduce((b, a) => (!b || a.evBB > b.evBB ? a : b), advice.actions[0]);
  return (
    <div className="rounded border border-sky-900 bg-sky-950/20 p-3 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sky-300 font-medium">▶ {advice.recommendation.reason}</div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            {advice.confidence}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300 text-sm"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1">
        {advice.actions.map((a, i) => (
          <div
            key={`${a.type}-${i}`}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${a === best ? "bg-neutral-900 ring-1 ring-sky-700/50" : ""}`}
          >
            <span className="w-24 font-mono text-neutral-300">
              {a.type}
              {a.sizeBB ? ` ${a.sizeBB.toFixed(1)}bb` : ""}
            </span>
            <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-sky-700"
                style={{ width: `${Math.round((a.frequency ?? 0) * 100)}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-neutral-400">
              {Math.round((a.frequency ?? 0) * 100)}%
            </span>
            <span
              className={`w-20 text-right text-xs ${a.evBB >= 0 ? "text-emerald-300" : "text-red-300"}`}
            >
              {a.evBB >= 0 ? "+" : ""}
              {a.evBB.toFixed(2)}bb
            </span>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 pt-1">
        {advice.factors.map((f) => (
          <div key={f.label} className="text-xs">
            <span className="text-neutral-300 font-medium">
              {f.label}: {f.value}
            </span>
            <div className="text-neutral-500">{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewPanel({ grades }: { grades: Grade[] }) {
  const VERDICT: Record<string, string> = {
    optimal: "text-emerald-400",
    minor: "text-lime-400",
    suspect: "text-amber-400",
    blunder: "text-red-400",
    unknown: "text-neutral-400",
  };
  return (
    <div className="rounded border border-neutral-800 p-3 space-y-1">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500">Post-hand review</h3>
      {grades.length === 0 && <p className="text-sm text-neutral-600">No graded decisions.</p>}
      {grades.map((g) => {
        const s = g.decision.spot;
        return (
          <div
            key={`${s.street}-${s.actionIndex}-${g.decision.heroAction.type}`}
            className="flex items-center gap-2 text-sm"
          >
            <span className="w-16 text-neutral-500">{s.street}</span>
            <span className="w-20">you {g.decision.heroAction.type}</span>
            <span className={`w-20 font-medium ${VERDICT[g.verdict]}`}>{g.verdict}</span>
            {g.evLossBB > 0.01 && (
              <span className="text-amber-500 text-xs">−{g.evLossBB.toFixed(2)}bb</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2)
    return <span className="text-xs text-neutral-600">session graph builds as you play</span>;
  const w = 220;
  const h = 36;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const last = data[data.length - 1] ?? 0;
  const color = last >= 0 ? "#34d399" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} role="img">
        <title>Session chip count</title>
        <line
          x1={0}
          y1={h - ((0 - min) / range) * h}
          x2={w}
          y2={h - ((0 - min) / range) * h}
          stroke="#404040"
          strokeWidth={0.5}
          strokeDasharray="2 3"
        />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
      <span className={`text-sm tabular-nums ${last >= 0 ? "text-emerald-400" : "text-red-400"}`}>
        {last >= 0 ? "+" : ""}
        {last}
      </span>
    </div>
  );
}

function difficultyLabel(d: number): string {
  if (d < 0.25) return "beginner";
  if (d < 0.5) return "casual";
  if (d < 0.75) return "solid";
  return "GTO";
}
