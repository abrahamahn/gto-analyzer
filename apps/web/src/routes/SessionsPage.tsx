import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { api } from "../lib/api.js";
import { shortDate } from "../lib/format.js";

export function SessionsPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.listSessions });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadSession(file),
    onSuccess: (r) => {
      setLastResult(
        `imported ${r.inserted} new hands (${r.duplicates} duplicates, ${r.totalParsed} parsed)`,
      );
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => setLastResult(`error: ${e.message}`),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Upload CoinPoker hand history <code>.txt</code> exports.
        </p>
      </div>

      <section className="rounded border border-neutral-800 p-4 space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
          className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 text-sm font-medium"
        >
          {upload.isPending ? "uploading…" : "Upload .txt file"}
        </button>
        {lastResult && <p className="text-sm text-neutral-400">{lastResult}</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">Imported sessions</h2>
        {sessions.isLoading && <p className="text-sm text-neutral-500">loading…</p>}
        {sessions.error && (
          <p className="text-sm text-red-400">server unreachable: {sessions.error.message}</p>
        )}
        {sessions.data && sessions.data.sessions.length === 0 && (
          <p className="text-sm text-neutral-500">none yet — upload a file above.</p>
        )}
        {sessions.data && sessions.data.sessions.length > 0 && (
          <div className="rounded border border-neutral-800 divide-y divide-neutral-800">
            {sessions.data.sessions.map((s) => (
              <Link
                key={s.id}
                to="/sessions/$id"
                params={{ id: s.id }}
                className="block px-4 py-3 hover:bg-neutral-900 grid grid-cols-[1fr_auto_auto] gap-4 items-center"
              >
                <div>
                  <div className="text-sm font-medium">{s.filename ?? "(no filename)"}</div>
                  <div className="text-xs text-neutral-500">{shortDate(s.importedAt)}</div>
                </div>
                <div className="text-xs text-neutral-400 uppercase tracking-wide">{s.source}</div>
                <div className="text-sm tabular-nums">{s.handCount} hands</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
