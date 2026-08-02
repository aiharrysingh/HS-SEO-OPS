"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type State =
  | { kind: "idle" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function RunAuditButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = async () => {
    setBusy(true);
    setState({ kind: "idle" });
    try {
      const res = await fetch(`/api/clients/${clientId}/audit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: body.error ?? "Audit failed" });
        return;
      }
      setState({
        kind: "done",
        message: `${body.findings} finding${body.findings === 1 ? "" : "s"} from ${body.pagesSampled} sampled pages.`,
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
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
      >
        {running ? "Auditing…" : "Run audit"}
      </button>

      {state.kind !== "idle" && (
        <div
          role="status"
          className={`absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border px-3 py-2 text-xs shadow-sm ${
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
