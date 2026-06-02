import type { Action, StreetActions } from "@poker/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { DecisionAnalysis } from "../components/DecisionAnalysis.js";
import { HandReplay } from "../components/HandReplay.js";
import { PlayingCard } from "../components/PlayingCard.js";
import { api } from "../lib/api.js";
import { formatAmount, shortDate } from "../lib/format.js";

export function HandDetailPage() {
  const { id } = useParams({ from: "/hands/$id" });
  const hand = useQuery({ queryKey: ["hand", id], queryFn: () => api.getHand(id) });
  const decisions = useQuery({
    queryKey: ["hand-decisions", id],
    queryFn: () => api.getHandDecisions(id),
  });

  if (hand.isLoading) return <p className="text-sm text-neutral-500">loading…</p>;
  if (hand.error || !hand.data)
    return <p className="text-sm text-red-400">{hand.error?.message ?? "not found"}</p>;

  const h = hand.data;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-baseline gap-3">
        <Link to="/sessions" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← sessions
        </Link>
        <h1 className="text-lg font-semibold font-mono">#{h.handId}</h1>
        <span className="text-sm text-neutral-500">{shortDate(h.playedAt)}</span>
      </div>

      <section className="rounded border border-neutral-800 p-4 space-y-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <div className="text-neutral-500">Table</div>
          <div>{h.table}</div>
          <div className="text-neutral-500">Blinds</div>
          <div>
            {formatAmount(h.smallBlind, h.currency)} / {formatAmount(h.bigBlind, h.currency)}
            {h.ante > 0 && <> · ante {formatAmount(h.ante, h.currency)}</>}
          </div>
          <div className="text-neutral-500">Hero</div>
          <div className="flex items-center gap-2">
            <span>{h.hero}</span>
            {h.heroCards && (
              <span className="flex gap-1">
                <PlayingCard card={h.heroCards[0]} size="md" />
                <PlayingCard card={h.heroCards[1]} size="md" />
              </span>
            )}
          </div>
        </div>
      </section>

      <HandReplay
        key={h.handId}
        hand={h}
        grades={decisions.data?.grades}
        analysisPending={decisions.isLoading}
      />

      <section className="rounded border border-neutral-800 p-4 space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500">Seats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {h.seats.map((s) => (
            <div
              key={s.seat}
              className={`rounded border border-neutral-800 px-2 py-1 ${s.player === h.hero ? "bg-neutral-900" : ""}`}
            >
              <div className="flex justify-between">
                <span className="font-medium">
                  {s.position && <span className="text-amber-400 mr-1">{s.position}</span>}
                  {s.player}
                </span>
                <span className="text-neutral-400 tabular-nums text-xs">
                  {formatAmount(s.stack, h.currency)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500">Decision details</h2>
        {decisions.isLoading && <p className="text-sm text-neutral-600">analyzing…</p>}
        {decisions.error && (
          <p className="text-sm text-red-400">{(decisions.error as Error).message}</p>
        )}
        {decisions.data && <DecisionAnalysis handId={id} grades={decisions.data.grades} />}
      </section>

      <section className="space-y-4">
        {h.streets.map((st) => (
          <StreetBlock key={st.street} street={st} currency={h.currency} hero={h.hero} />
        ))}
      </section>

      <section className="rounded border border-neutral-800 p-4 text-sm space-y-1">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Summary</div>
        <div>
          Total pot {formatAmount(h.potTotal, h.currency)}
          {h.rake > 0 && <> · rake {formatAmount(h.rake, h.currency)}</>}
        </div>
        {h.winners.map((w) => (
          <div key={w.player} className={w.player === h.hero ? "text-emerald-400" : ""}>
            {w.player} won {formatAmount(w.amount, h.currency)}
          </div>
        ))}
      </section>
    </div>
  );
}

function StreetBlock({
  street,
  currency,
  hero,
}: {
  street: StreetActions;
  currency: string;
  hero: string;
}) {
  const inPlay = street.actions.filter(
    (a) => a.type !== "post-ante" && a.type !== "post-sb" && a.type !== "post-bb",
  );
  const posts = street.actions.filter(
    (a) => a.type === "post-ante" || a.type === "post-sb" || a.type === "post-bb",
  );
  return (
    <div className="rounded border border-neutral-800 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {street.street}
        </h3>
        {street.board.length > 0 && (
          <div className="flex gap-1">
            {street.board.map((c, idx) => (
              <PlayingCard key={`${c.rank}${c.suit}-${idx}`} card={c} size="md" />
            ))}
          </div>
        )}
      </div>
      {posts.length > 0 && (
        <div className="text-xs text-neutral-500">
          {posts.map((p, i) => (
            <span key={streetActionKey(p, i)}>
              {i > 0 && " · "}
              {p.actor} {postLabel(p)} {p.amount && formatAmount(p.amount, currency)}
            </span>
          ))}
        </div>
      )}
      <ul className="space-y-0.5 font-mono text-sm">
        {inPlay.map((a, i) => (
          <li
            key={streetActionKey(a, i)}
            className={a.actor === hero ? "text-emerald-300" : "text-neutral-300"}
          >
            <span className="text-neutral-500 inline-block w-32 truncate">{a.actor}</span>
            <span> {actionVerb(a)}</span>
            {a.amount !== undefined && <span> {formatAmount(a.amount, currency)}</span>}
          </li>
        ))}
        {inPlay.length === 0 && <li className="text-xs text-neutral-600">(no in-play actions)</li>}
      </ul>
    </div>
  );
}

function streetActionKey(action: Action, index: number): string {
  return `${action.actor}:${action.type}:${action.amount ?? ""}:${index}`;
}

function postLabel(a: Action): string {
  if (a.type === "post-ante") return "ante";
  if (a.type === "post-sb") return "SB";
  if (a.type === "post-bb") return "BB";
  return a.type;
}

function actionVerb(a: Action): string {
  switch (a.type) {
    case "fold":
      return "folds";
    case "check":
      return "checks";
    case "call":
      return "calls";
    case "bet":
      return "bets";
    case "raise":
      return "raises to";
    case "all-in":
      return "all-in";
    default:
      return a.type;
  }
}
