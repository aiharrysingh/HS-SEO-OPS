"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * The curated half of a page's data.
 *
 * Search Console supplies traffic; it has no idea when a page went live or
 * what it was written to rank for. Detection covers pages that state a date in
 * their own metadata — typically blog posts — and leaves landing pages and
 * older content to a human, which is what this is for.
 */
export function PageMetaForm({
  pageId,
  publishedAt,
  targetKeyword,
  type,
  cutoff,
}: {
  pageId: string;
  publishedAt: string | null;
  targetKeyword: string | null;
  type: "blog" | "landing";
  /** Latest selectable day, so a future publish date can't be entered. */
  cutoff: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(publishedAt ?? "");
  const [keyword, setKeyword] = useState(targetKeyword ?? "");
  const [pageType, setPageType] = useState(type);
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty =
    date !== (publishedAt ?? "") ||
    keyword !== (targetKeyword ?? "") ||
    pageType !== type;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishedAt: date || null,
          targetKeyword: keyword || null,
          type: pageType,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setSavedAt(new Date().toLocaleTimeString());
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || pending;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs">
        <span className="block text-ink-secondary">Publish date</span>
        <input
          type="date"
          value={date}
          max={cutoff}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
        />
      </label>

      <label className="min-w-0 flex-1 text-xs">
        <span className="block text-ink-secondary">Target keyword</span>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="What this page should rank for"
          className="mt-1 w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
        />
      </label>

      <label className="text-xs">
        <span className="block text-ink-secondary">Type</span>
        <select
          value={pageType}
          onChange={(e) => setPageType(e.target.value as "blog" | "landing")}
          className="mt-1 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink"
        >
          <option value="blog">Blog</option>
          <option value="landing">Landing</option>
        </select>
      </label>

      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>

      {error && <span className="text-xs text-critical">{error}</span>}
      {!error && savedAt && !dirty && (
        <span className="text-xs text-ink-muted">Saved {savedAt}</span>
      )}
      {!publishedAt && !date && (
        <span className="text-xs text-ink-muted">
          Without a publish date the milestone columns stay empty.
        </span>
      )}
    </div>
  );
}
