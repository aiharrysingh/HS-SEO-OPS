"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "./ui";

type Status = "draft" | "approved" | "sent";

/**
 * Edit, record the work log, and approve.
 *
 * A textarea with a live preview rather than a rich editor: reports are stored
 * as markdown, the team writes markdown, and a WYSIWYG layer would add a
 * dependency plus a lossy round-trip for no gain.
 */
export function ReportEditor({
  reportId,
  initialContent,
  initialWorkDelivered,
  initialStatus,
  previewHtml,
}: {
  reportId: string;
  initialContent: string;
  initialWorkDelivered: string;
  initialStatus: Status;
  previewHtml: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [work, setWork] = useState(initialWorkDelivered);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  const dirty = content !== initialContent || work !== initialWorkDelivered;

  // Warn before losing edits — an accidental back button after 10 minutes of
  // rewriting is a real way to lose work.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports/${reportId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Save failed");
          return false;
        }
        setSavedAt(new Date().toLocaleTimeString("en-GB"));
        startTransition(() => router.refresh());
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reportId, router],
  );

  const busy = saving || pending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-hairline bg-page p-0.5">
          {(["edit", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                tab === t
                  ? "bg-surface font-medium text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <Badge tone={status === "draft" ? "warning" : "good"}>{status}</Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty && !busy && (
            <span className="text-xs text-ink-muted">Unsaved changes</span>
          )}
          {!dirty && savedAt && (
            <span className="text-xs text-ink-muted">Saved {savedAt}</span>
          )}

          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => patch({ content, workDelivered: work })}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>

          {status === "draft" ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                // Save first: approving with unsaved edits would freeze the
                // wrong text.
                if (dirty && !(await patch({ content, workDelivered: work })))
                  return;
                if (await patch({ status: "approved" })) setStatus("approved");
              }}
              className="rounded-lg border border-hairline bg-wash-good px-3 py-1.5 text-xs font-medium text-good-text transition-colors hover:opacity-80 disabled:opacity-50"
            >
              Approve
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await patch({ status: "draft" })) setStatus("draft");
              }}
              className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-page disabled:opacity-50"
            >
              Reopen as draft
            </button>
          )}

          <Link
            href={`/reports/${reportId}/export`}
            target="_blank"
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
          >
            Export
          </Link>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-hairline bg-wash-critical px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
          Work delivered this period
        </span>
        <textarea
          value={work}
          onChange={(e) => setWork(e.target.value)}
          rows={3}
          placeholder="What the team actually did — the report ties movement to this. Left empty, the report says so rather than inventing activity."
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
        />
        <span className="mt-1 block text-[11px] text-ink-muted">
          Saved with the report. Regenerating re-reads this, so fill it in before
          regenerating for a better draft.
        </span>
      </label>

      {tab === "edit" ? (
        <MarkdownArea value={content} onChange={setContent} />
      ) : (
        <article
          className="report-prose rounded-xl border border-hairline bg-surface px-5 py-4"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </div>
  );
}

/** Textarea that grows with content and keeps tab characters out of the way. */
function MarkdownArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck
      className="min-h-[60vh] w-full rounded-xl border border-hairline bg-surface px-4 py-3 font-mono text-[13px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
    />
  );
}
