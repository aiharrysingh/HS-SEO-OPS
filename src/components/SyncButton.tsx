"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type State =
  | { kind: "idle" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string }
  | { kind: "info"; message: string };

const TICK_MS = 1000;
const POLL_MS = 3000;

/** Honest elapsed time, not a fake percentage — GSC's API never says how many rows are left. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s elapsed` : `${seconds}s elapsed`;
}

export function SyncButton({
  clientId,
  initiallySyncing,
  syncStartedAt,
  isFirstSync,
}: {
  clientId: string;
  /** True if the client row already had a live (non-stale) syncStartedAt at page load. */
  initiallySyncing: boolean;
  syncStartedAt: string | null;
  isFirstSync: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(initiallySyncing);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    initiallySyncing && syncStartedAt ? new Date(syncStartedAt).getTime() : null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [state, setState] = useState<State>({ kind: "idle" });

  // Elapsed-time ticker and completion polling — both only while syncing, and
  // both stop the moment `syncing` flips false (including a refresh landing
  // mid-sync: `initiallySyncing` seeds this same state, so it picks up here).
  useEffect(() => {
    if (!syncing) return;

    const tick = setInterval(() => setNowMs(Date.now()), TICK_MS);

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/sync/status`);
        if (!res.ok) return;
        const body = await res.json();
        if (!body.syncing) {
          setSyncing(false);
          setState(
            body.lastSyncError
              ? { kind: "error", message: body.lastSyncError }
              : { kind: "done", message: "Sync finished." },
          );
          startTransition(() => router.refresh());
        }
      } catch {
        // A transient failure to poll isn't itself a sync failure — retry next tick.
      }
    }, POLL_MS);

    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [syncing, clientId, router, startTransition]);

  const run = async () => {
    setSyncing(true);
    setStartedAtMs(Date.now());
    setState({ kind: "idle" });
    try {
      const res = await fetch(`/api/clients/${clientId}/sync`, { method: "POST" });
      const body = await res.json();

      if (res.status === 409) {
        // Not an error — something else (a second click, the nightly cron) is
        // already syncing this client. Reflect its real start time and keep
        // polling; the effect above is already running from the optimistic
        // setSyncing(true) just above.
        setStartedAtMs(body.startedAt ? new Date(body.startedAt).getTime() : Date.now());
        setState({ kind: "info", message: body.error });
        return;
      }

      if (!res.ok) {
        setSyncing(false);
        setState({ kind: "error", message: body.error ?? "Sync failed" });
        return;
      }

      const unmatched = body.unmatchedUrls?.length ?? 0;
      setSyncing(false);
      setState({
        kind: "done",
        message:
          `Stored ${body.rowsStored} rows for ${body.start} – ${body.end}.` +
          (unmatched
            ? ` ${unmatched} URL${unmatched === 1 ? "" : "s"} from Search Console aren't tracked yet.`
            : ""),
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setSyncing(false);
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const running = syncing || pending;
  const elapsed = syncing ? formatElapsed(nowMs - (startedAtMs ?? nowMs)) : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
      >
        {syncing ? `Syncing… ${elapsed}` : "Sync now"}
      </button>

      {syncing && (
        <div
          role="status"
          className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-hairline bg-surface px-3 py-2 text-xs text-ink-secondary shadow-sm"
        >
          <p className="leading-snug">
            {isFirstSync
              ? "First sync — backfilling ~480 days of Search Console history. This can take a few minutes."
              : "Pulling the last few days to catch any revisions."}
          </p>
          {state.kind === "info" && (
            <p className="mt-1 leading-snug text-ink-muted">{state.message}</p>
          )}
        </div>
      )}

      {!syncing && state.kind !== "idle" && (
        <div
          role="status"
          className={`absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border px-3 py-2 text-xs shadow-sm ${
            state.kind === "error"
              ? "border-hairline bg-wash-critical text-critical"
              : "border-hairline bg-surface text-ink-secondary"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="leading-snug">{state.message}</p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="shrink-0 text-ink-muted hover:text-ink"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
