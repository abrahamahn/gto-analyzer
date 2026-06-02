import { useQuery } from "@tanstack/react-query";

interface Health {
  ok: boolean;
  service: string;
  dbPath: string;
  handCount: number;
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

export function HomePage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">poker</h1>
        <p className="text-neutral-400 mt-1">
          Personal NLHE cash and tournament study tool — post-session analyzer and manual spot
          trainer.
        </p>
      </div>

      <section className="rounded border border-neutral-800 p-4">
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">Server status</h2>
        {isLoading && <p className="text-neutral-400 text-sm">checking…</p>}
        {error && (
          <p className="text-red-400 text-sm">
            unreachable — is <code>pnpm dev</code> running both processes?
          </p>
        )}
        {data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-neutral-400">service</dt>
            <dd>{data.service}</dd>
            <dt className="text-neutral-400">db</dt>
            <dd className="font-mono text-xs">{data.dbPath}</dd>
            <dt className="text-neutral-400">hands stored</dt>
            <dd>{data.handCount}</dd>
          </dl>
        )}
      </section>

      <section className="rounded border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
        <p className="font-semibold mb-1">Reminder</p>
        <p className="text-amber-200/80">
          This tool reads exported hand history files <em>after</em> a session ends. It does not
          read live game state during play — that would be RTA and is against CoinPoker's rules.
        </p>
      </section>
    </div>
  );
}
