"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type State =
  | { kind: "idle" }
  | { kind: "done"; message: string; remaining: number }
  | { kind: "error"; message: string };

/**
 * Fills in publish dates so the milestone columns can work.
 *
 * Reports what it could *not* date as prominently as what it could — the
 * pages left over are the ones a human has to type in, and hiding that count
 * would make a half-finished job look complete.
 */
export function DetectDatesButton({
  clientId,
  undatedCount,
}: {
  clientId: string;
  undatedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });

  if (undatedCount === 0 && state.kind === "idle") return null;

  const run = async () => {
    setBusy(true);
    setState({ kind: "idle" });
    try {
      const res = await fetch(`/api/clients/${clientId}/detect-dates`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: body.error ?? "Detection failed" });
        return;
      }
      setState({
        kind: body.stoppedEarly ? "error" : "done",
        remaining: body.remaining,
        message:
          `Dated ${body.dated} of ${body.scanned} pages. ` +
          (body.undated > 0
            ? `${body.undated} state no publish date — set those by hand on the page screen. `
            : "") +
          (body.failed > 0 ? `${body.failed} couldn't be fetched. ` : "") +
          (body.stoppedEarly
            ? body.stoppedEarly
            : body.remaining > 0
              ? `${body.remaining} still undated — run again to continue.`
              : "All pages now have a date."),
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const running = busy || pending;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={running}
        title="Read each page's own structured metadata for the date it says it was published"
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
      >
        {running ? "Detecting…" : `Detect dates (${undatedCount})`}
      </button>

      {state.kind !== "idle" && (
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
