"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function GenerateReportButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"weekly" | "monthly" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = async (cadence: "weekly" | "monthly") => {
    setBusy(cadence);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cadence }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Generation failed");
        return;
      }
      startTransition(() => {
        router.refresh();
        router.push(`/clients/${clientId}/reports/${json.reportId}`);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const running = busy !== null || pending;

  return (
    <div className="relative">
      <div className="inline-flex items-center gap-2">
        {(["weekly", "monthly"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => run(c)}
            disabled={running}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
          >
            {busy === c ? "Generating…" : `Generate ${c}`}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="status"
          className="absolute right-0 top-full z-20 mt-2 w-96 rounded-lg border border-hairline bg-wash-critical px-3 py-2 text-xs text-critical shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="leading-snug">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
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
