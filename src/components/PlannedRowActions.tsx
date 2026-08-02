"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Publish or drop a planned piece from the calendar. */
export function PlannedRowActions({
  clientId,
  pageId,
}: {
  clientId: string;
  pageId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"publish" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "publish" | "remove") {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not update.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {error && <span className="text-xs text-critical">{error}</span>}
      <button
        type="button"
        onClick={() => run("publish")}
        disabled={pending !== null}
        title="Mark live — its planned date becomes the go-live date milestones measure from"
        className="rounded-lg border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
      >
        {pending === "publish" ? "…" : "Mark live"}
      </button>
      <button
        type="button"
        onClick={() => run("remove")}
        disabled={pending !== null}
        className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:text-critical disabled:opacity-50"
        aria-label="Remove from calendar"
      >
        {pending === "remove" ? "…" : "✕"}
      </button>
    </div>
  );
}
