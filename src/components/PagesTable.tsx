"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PageRow } from "@/lib/metrics";
import {
  MILESTONES,
  type DateWindow,
  type MilestoneKey,
  withFilters,
} from "@/lib/dates";
import { compact, delta, full, percent, position } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { Badge, DeltaBadge } from "./ui";

type View = "current" | "milestones";
type SortKey =
  | "title"
  | "published"
  | "clicks"
  | "change"
  | "impressions"
  | "ctr"
  | "position"
  | `m:${MilestoneKey}`;

/**
 * The Phase 1 deliverable: every page for a client with live GSC numbers.
 *
 * Two views over the same rows rather than one very wide table — "how is this
 * performing now" and "how did it perform from go-live" are different
 * questions, and cramming both into one row makes neither readable.
 */
export function PagesTable({
  clientId,
  pages,
  windowLabel,
  window,
}: {
  clientId: string;
  pages: PageRow[];
  windowLabel: string;
  /** Carried onto each row link so the active range survives the click. */
  window: DateWindow;
}) {
  const [view, setView] = useState<View>("current");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "blog" | "landing">("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "clicks",
    desc: true,
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = pages.filter((p) => {
      if (type !== "all" && p.type !== type) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        (p.targetKeyword ?? "").toLowerCase().includes(q)
      );
    });

    const value = (p: PageRow): number | string => {
      switch (sort.key) {
        case "title":
          return p.title.toLowerCase();
        case "published":
          return p.publishedAt ?? "";
        case "clicks":
          return p.current.clicks;
        case "change":
          return p.current.clicks - p.previous.clicks;
        case "impressions":
          return p.current.impressions;
        case "ctr":
          return p.current.ctr;
        case "position":
          // Unranked pages sort last in both directions rather than pretending
          // to be position 0, which would put them at the top of "best".
          return p.current.position ?? 999;
        default: {
          // Pages too young to have reached the milestone sort below zero, so
          // "best first month" never opens with a column of dashes.
          const key = sort.key.slice(2) as MilestoneKey;
          return p.milestones[key]?.clicks ?? -1;
        }
      }
    };

    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sort.desc ? -cmp : cmp;
    });
  }, [pages, query, type, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "title" },
    );

  return (
    <section className="rounded-xl border border-hairline bg-surface">
      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
        <Segmented
          value={view}
          onChange={(v) => {
            const next = v as View;
            setView(next);
            // Each view has its own meaningful default; carrying "sorted by
            // clicks" into a table with no clicks column leaves the order
            // unexplained.
            setSort({
              key: next === "milestones" ? "m:month3" : "clicks",
              desc: true,
            });
          }}
          options={[
            { value: "current", label: windowLabel },
            { value: "milestones", label: "From go-live" },
          ]}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            value={type}
            onChange={(v) => setType(v as typeof type)}
            options={[
              { value: "all", label: "All" },
              { value: "blog", label: "Blog" },
              { value: "landing", label: "Landing" },
            ]}
          />
          <label className="relative">
            <span className="sr-only">Search pages</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, path or keyword"
              className="w-56 rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
            />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">
            {view === "current"
              ? `Page performance over ${windowLabel}`
              : "Page performance measured from each page's publish date"}
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
              <SortTh
                className="pl-4"
                label="Page"
                sortKey="title"
                sort={sort}
                onSort={toggleSort}
              />
              <SortTh
                label="Published"
                sortKey="published"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              {view === "current" ? (
                <>
                  <SortTh
                    label="Clicks"
                    sortKey="clicks"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortTh
                    label="vs prev"
                    sortKey="change"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortTh
                    label="Impr."
                    sortKey="impressions"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortTh
                    label="CTR"
                    sortKey="ctr"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortTh
                    label="Pos."
                    sortKey="position"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <th scope="col" className="px-3 py-2 pr-4 font-medium">
                    Trend
                  </th>
                </>
              ) : (
                MILESTONES.map((m) => (
                  <SortTh
                    key={m.key}
                    label={m.label}
                    sortKey={`m:${m.key}`}
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                    className="last:pr-4"
                  />
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="border-b border-hairline last:border-0 hover:bg-page"
              >
                <td className="max-w-[380px] py-2.5 pl-4 pr-3">
                  <Link
                    href={withFilters(
                      `/clients/${clientId}/pages/${p.id}`,
                      window,
                    )}
                    className="block truncate font-medium text-ink hover:underline"
                    title={p.title}
                  >
                    {p.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge tone={p.type === "landing" ? "blue" : "neutral"}>
                      {p.type}
                    </Badge>
                    <span
                      className="truncate text-xs text-ink-muted"
                      title={p.url}
                    >
                      {p.path}
                    </span>
                  </div>
                </td>

                <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-ink-secondary">
                  {p.publishedAt ?? "—"}
                  {p.ageDays !== null && (
                    <div className="text-xs text-ink-muted">
                      {formatAge(p.ageDays)}
                    </div>
                  )}
                </td>

                {view === "current" ? (
                  <>
                    <td className="tnum px-3 py-2.5 text-right font-medium text-ink">
                      {full(p.current.clicks)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <DeltaBadge
                        d={delta(p.current.clicks, p.previous.clicks)}
                      />
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {compact(p.current.impressions)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {percent(p.current.ctr)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {position(p.current.position)}
                    </td>
                    <td className="px-3 py-2.5 pr-4">
                      <Sparkline
                        values={p.spark}
                        title={`${p.title} daily clicks`}
                      />
                    </td>
                  </>
                ) : (
                  MILESTONES.map((m) => {
                    const t = p.milestones[m.key];
                    return (
                      <td
                        key={m.key}
                        className="tnum px-3 py-2.5 text-right last:pr-4"
                      >
                        {t ? (
                          <>
                            <span className="font-medium text-ink">
                              {full(t.clicks)}
                            </span>
                            <div className="text-xs text-ink-muted">
                              {compact(t.impressions)} impr.
                            </div>
                          </>
                        ) : (
                          <span
                            className="text-ink-muted"
                            title={`Page is not yet ${m.days} days old`}
                          >
                            —
                          </span>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={view === "current" ? 8 : 6}
                  className="px-4 py-10 text-center text-sm text-ink-secondary"
                >
                  No pages match those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
        {view === "current" ? (
          <>
            Showing {rows.length} of {pages.length} pages. Change is against the
            equivalent preceding period.
          </>
        ) : (
          <>
            Cumulative clicks in each page&apos;s first 7, 30, 90 and 180 days
            live — so a page published last March and one published last week
            are compared at the same age. &ldquo;—&rdquo; means the page has not
            reached that age yet.
          </>
        )}
      </div>
    </section>
  );
}

function formatAge(days: number): string {
  if (days < 31) return `${days}d old`;
  if (days < 365) return `${Math.round(days / 30)}mo old`;
  const years = days / 365;
  return `${years.toFixed(years < 10 ? 1 : 0)}y old`;
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-hairline bg-page p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === o.value
              ? "bg-surface font-medium text-ink shadow-sm"
              : "text-ink-secondary hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const activeSort = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={activeSort ? (sort.desc ? "descending" : "ascending") : "none"}
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-ink ${
          activeSort ? "text-ink" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {activeSort ? (sort.desc ? "▼" : "▲") : "▾"}
        </span>
      </button>
    </th>
  );
}
