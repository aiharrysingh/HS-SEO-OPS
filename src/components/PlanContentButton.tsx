"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Turns a keyword opportunity into a calendar entry.
 *
 * Opens with the term prefilled as both working title and target keyword —
 * the point of the screen is that planning a piece from evidence should take
 * one click and one date, not a form.
 */
export function PlanContentButton({
  clientId,
  query,
  suggestedType = "blog",
}: {
  clientId: string;
  query: string;
  suggestedType?: "blog" | "landing";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(query);
  const [plannedFor, setPlannedFor] = useState("");
  const [type, setType] = useState<"blog" | "landing">(suggestedType);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setTitle(query);
        setPlannedFor("");
        setError(null);
      }
      return !wasOpen;
    });
  };

  async function save() {
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          targetKeyword: query,
          plannedFor: plannedFor || undefined,
          type,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not add to the calendar.");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink"
      >
        Plan
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Plan content for ${query}`}
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-hairline bg-surface px-3 py-3 text-xs shadow-sm"
        >
          <label className="block">
            <span className="text-ink-secondary">Working title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
            />
          </label>

          <div className="mt-2 flex items-center gap-2">
            <label className="flex-1">
              <span className="text-ink-secondary">Planned for</span>
              <input
                type="date"
                value={plannedFor}
                onChange={(e) => setPlannedFor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
            <label>
              <span className="text-ink-secondary">Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "blog" | "landing")}
                className="mt-1 block rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink"
              >
                <option value="blog">Blog</option>
                <option value="landing">Landing</option>
              </select>
            </label>
          </div>

          <p className="mt-2 leading-snug text-ink-muted">
            Target keyword: <span className="text-ink-secondary">{query}</span>
          </p>

          {error && <p className="mt-2 leading-snug text-critical">{error}</p>}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !title.trim()}
              className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add to calendar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
