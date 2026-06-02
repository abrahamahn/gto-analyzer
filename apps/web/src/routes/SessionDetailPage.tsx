import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api, type HandListItem } from "../lib/api.js";
import { formatAmount, formatSigned, shortDate, SUIT_COLOR, SUIT_SYMBOL } from "../lib/format.js";

export function SessionDetailPage() {
  const { id } = useParams({ from: "/sessions/$id" });
  const session = useQuery({ queryKey: ["session", id], queryFn: () => api.getSession(id) });
  const hands = useQuery({ queryKey: ["hands", id], queryFn: () => api.listHands(id) });

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-baseline gap-3">
        <Link to="/sessions" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← sessions
        </Link>
        <h1 className="text-xl font-semibold">
          {session.data?.filename ?? "session"}
        </h1>
        <span className="text-sm text-neutral-500">{session.data?.handCount} hands</span>
      </div>

      {hands.isLoading && <p className="text-sm text-neutral-500">loading…</p>}
      {hands.data && hands.data.hands.length === 0 && (
        <p className="text-sm text-neutral-500">no hands.</p>
      )}
      {hands.data && hands.data.hands.length > 0 && (
        <div className="rounded border border-neutral-800 overflow-hidden">
          <div className="grid grid-cols-[6rem_1fr_5rem_5rem_6rem_6rem] gap-2 px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800">
            <div>time</div>
            <div>table</div>
            <div>hand</div>
            <div className="text-right">blinds</div>
            <div className="text-right">pot</div>
            <div className="text-right">result</div>
          </div>
          {hands.data.hands.map((h) => (
            <Link
              key={h.id}
              to="/hands/$id"
              params={{ id: h.id }}
              className="grid grid-cols-[6rem_1fr_5rem_5rem_6rem_6rem] gap-2 px-3 py-1.5 text-sm items-center hover:bg-neutral-900 border-b border-neutral-900 tabular-nums"
            >
              <div className="text-neutral-400 text-xs">{shortDate(h.playedAt)}</div>
              <div className="truncate text-neutral-300">{h.table}</div>
              <HeroCards str={h.heroCards} />
              <div className="text-right text-neutral-400 text-xs">
                {formatAmount(h.smallBlind, h.currency)}/{formatAmount(h.bigBlind, h.currency)}
              </div>
              <div className="text-right">{formatAmount(h.potTotal, h.currency)}</div>
              <Result h={h} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function HeroCards({ str }: { str: string | null }) {
  if (!str || str.length !== 4) return <span className="text-neutral-700">—</span>;
  const c1 = { rank: str[0]!, suit: str[1]! };
  const c2 = { rank: str[2]!, suit: str[3]! };
  return (
    <div className="flex gap-1 font-mono">
      <span className={SUIT_COLOR[c1.suit]}>
        {c1.rank}
        {SUIT_SYMBOL[c1.suit]}
      </span>
      <span className={SUIT_COLOR[c2.suit]}>
        {c2.rank}
        {SUIT_SYMBOL[c2.suit]}
      </span>
    </div>
  );
}

function Result({ h }: { h: HandListItem }) {
  const cls =
    h.heroResult > 0 ? "text-emerald-400" : h.heroResult < 0 ? "text-red-400" : "text-neutral-500";
  return <div className={`text-right ${cls}`}>{formatSigned(h.heroResult, h.currency)}</div>;
}
