"use client";

import { useState } from "react";
import type { DraftReview, ReviewSeverity } from "@/lib/draftReview";
import { Badge, Card, CardHeader } from "./ui";

const VERDICT_LABEL: Record<DraftReview["verdict"], string> = {
  ship: "Ship it",
  "ship-after-fixes": "Ship after fixes",
  "needs-rewrite": "Needs a rewrite",
};

const VERDICT_TONE: Record<DraftReview["verdict"], "good" | "warning" | "critical"> = {
  ship: "good",
  "ship-after-fixes": "warning",
  "needs-rewrite": "critical",
};

const SEVERITY_TONE: Record<ReviewSeverity, "critical" | "warning" | "neutral" | "good"> = {
  critical: "critical",
  warning: "warning",
  info: "neutral",
  pass: "good",
};

const SECTION_LABEL = {
  "ai-tells": "AI writing tells",
  seo: "On-page SEO",
  citation: "AI-citation readiness",
} as const;

export function DraftReviewer({ defaultKeyword = "" }: { defaultKeyword?: string }) {
  const [markdown, setMarkdown] = useState("");
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [title, setTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [review, setReview] = useState<DraftReview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!markdown.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, targetKeyword: keyword, title, metaDescription }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Review failed.");
      setReview(body.review as DraftReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const grouped = review
    ? (["ai-tells", "seo", "citation"] as const).map((s) => ({
        section: s,
        items: review.findings.filter((f) => f.section === s),
      }))
    : [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Card>
        <CardHeader
          title="Draft"
          subtitle="Paste the piece as Markdown. Nothing is stored."
        />
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              <span className="block text-ink-secondary">Target keyword</span>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="what it should rank for"
                className="mt-1 w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
            <label className="text-xs">
              <span className="block text-ink-secondary">Title tag (optional)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="block text-ink-secondary">Meta description (optional)</span>
            <input
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
            />
          </label>

          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={22}
            placeholder={"# Your headline\n\nPaste the draft here…"}
            className="w-full resize-y rounded-lg border border-hairline bg-page px-3 py-2 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">
              {markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : ""}
            </span>
            <button
              type="button"
              onClick={run}
              disabled={pending || !markdown.trim()}
              className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
            >
              {pending ? "Reviewing…" : "Review draft"}
            </button>
          </div>
          {error && <p className="text-xs text-critical">{error}</p>}
        </div>
      </Card>

      <div className="space-y-4">
        {!review ? (
          <Card className="px-4 py-6">
            <p className="text-sm text-ink-secondary">
              Checks three things in one pass: whether it reads like a machine
              wrote it, whether it&apos;s optimised, and whether an AI engine
              can extract and cite it.
            </p>
          </Card>
        ) : (
          <>
            <Card className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={VERDICT_TONE[review.verdict]}>
                  {VERDICT_LABEL[review.verdict]}
                </Badge>
                <Badge
                  tone={
                    review.aiTellLevel === "heavy"
                      ? "critical"
                      : review.aiTellLevel === "moderate"
                        ? "warning"
                        : "good"
                  }
                >
                  AI tells: {review.aiTellLevel}
                </Badge>
                <span className="text-xs text-ink-muted">
                  {review.words} words · {review.readingMinutes} min read
                </span>
              </div>
              <p className="mt-2 text-sm leading-snug text-ink-secondary">
                {review.verdictReason}
              </p>
            </Card>

            {grouped.map(({ section, items }) =>
              items.length === 0 ? null : (
                <Card key={section}>
                  <CardHeader title={SECTION_LABEL[section]} />
                  <ul className="divide-y divide-hairline">
                    {items.map((f) => (
                      <li key={f.id} className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium text-ink">{f.title}</h3>
                            <p className="mt-0.5 text-sm leading-snug text-ink-secondary">
                              {f.detail}
                            </p>
                            {f.evidence.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5">
                                {f.evidence.map((e, i) => (
                                  <li
                                    key={i}
                                    className="truncate font-mono text-[11px] text-ink-muted"
                                  >
                                    {e}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ),
            )}

            {review.findings.length === 0 && (
              <Card className="px-4 py-6">
                <p className="text-sm text-ink-secondary">
                  Nothing flagged. The checks below still need a human.
                </p>
              </Card>
            )}

            <Card>
              <CardHeader
                title="Not checked automatically"
                subtitle="Listed rather than quietly skipped."
              />
              <ul className="space-y-2 px-4 py-3">
                {review.notAutomated.map((n, i) => (
                  <li key={i} className="text-sm leading-snug text-ink-secondary">
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
