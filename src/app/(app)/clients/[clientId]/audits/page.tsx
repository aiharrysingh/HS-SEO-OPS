import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatDate } from "@/lib/dates";
import type { AuditFinding, AuditResult, AuditSeverity } from "@/lib/audit";
import { RunAuditButton } from "@/components/RunAuditButton";
import { Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Severity is carried by a coloured rail *and* a written label, never colour
 * alone — the same rule the rest of the app follows for deltas. Colours come
 * from the reserved status tokens; none of the categorical series hues are
 * reused here.
 */
const SEVERITY: Record<
  AuditSeverity,
  { label: string; rail: string; text: string; order: number }
> = {
  critical: { label: "Critical", rail: "var(--critical)", text: "text-critical", order: 0 },
  serious: { label: "Serious", rail: "var(--serious)", text: "text-ink", order: 1 },
  warning: { label: "Warning", rail: "var(--warning)", text: "text-ink", order: 2 },
  info: { label: "Note", rail: "var(--axis)", text: "text-ink-secondary", order: 3 },
};

export default async function AuditsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) notFound();

  const rows = await db
    .select()
    .from(schema.audits)
    .where(eq(schema.audits.clientId, clientId))
    .orderBy(desc(schema.audits.createdAt))
    .limit(20);

  const latest = rows[0]?.findings as AuditResult | undefined;
  const previous = rows[1]?.findings as AuditResult | undefined;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Site audit
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {client.domain}
            {latest && (
              <>
                {" · "}last run {formatDate(latest.ranAt.slice(0, 10))}
                {" · "}
                {latest.pagesSampled} pages sampled
              </>
            )}
          </p>
        </div>
        <RunAuditButton clientId={clientId} />
      </header>

      {!latest ? (
        <EmptyState title="No audit yet">
          <p>
            <strong className="font-medium text-ink">Run audit</strong> checks
            robots.txt, the sitemap, a sample of pages and Core Web Vitals —
            crawlability, AI-crawler access, on-page basics and speed.
          </p>
        </EmptyState>
      ) : (
        <>
          <SeveritySummary latest={latest} previous={previous} />

          {latest.cwv && <CoreWebVitals cwv={latest.cwv} />}

          <FindingList
            title="Quick wins"
            subtitle="Meaningful impact, low risk, under about a week of work."
            findings={latest.findings.filter((f) => f.bucket === "quick-win")}
          />
          <FindingList
            title="Strategic"
            subtitle="Larger effort or dev resource, higher payoff."
            findings={latest.findings.filter((f) => f.bucket === "strategic")}
          />

          {latest.findings.length === 0 && (
            <EmptyState title="Nothing flagged">
              Every check that ran came back clean.
            </EmptyState>
          )}

          <Card>
            <CardHeader
              title="What this audit could see"
              subtitle="Checks that didn't run are listed, not counted as passes."
            />
            <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  Checked
                </p>
                <ul className="mt-1.5 space-y-1">
                  {latest.sources.map((s) => (
                    <li key={s} className="text-sm text-ink-secondary">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  Not checked
                </p>
                {latest.notRun.length === 0 ? (
                  <p className="mt-1.5 text-sm text-ink-secondary">
                    Nothing — every check ran.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {latest.notRun.map((s) => (
                      <li key={s} className="text-sm leading-snug text-ink-secondary">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          {rows.length > 1 && (
            <Card>
              <CardHeader
                title="Previous audits"
                subtitle="Kept so you can see whether findings actually got fixed."
              />
              <ul className="divide-y divide-hairline">
                {rows.slice(1).map((r) => {
                  const res = r.findings as AuditResult;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="text-ink-secondary">
                        {formatDate(res.ranAt.slice(0, 10))}
                      </span>
                      <span className="tnum text-xs text-ink-muted">
                        {res.findings.length} finding
                        {res.findings.length === 1 ? "" : "s"} ·{" "}
                        {res.pagesSampled} pages
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** Counts by severity. A tile, not a chart — five numbers don't need a plot. */
function SeveritySummary({
  latest,
  previous,
}: {
  latest: AuditResult;
  previous?: AuditResult;
}) {
  const order: AuditSeverity[] = ["critical", "serious", "warning", "info"];
  const count = (r: AuditResult, s: AuditSeverity) =>
    r.findings.filter((f) => f.severity === s).length;

  const total = latest.findings.length;
  const prevTotal = previous?.findings.length;
  const change =
    prevTotal === undefined ? null : total - prevTotal;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {order.map((s) => {
        const n = count(latest, s);
        const before = previous ? count(previous, s) : null;
        const delta = before === null ? null : n - before;
        return (
          <div
            key={s}
            className="relative overflow-hidden rounded-xl border border-hairline bg-surface px-4 py-3"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: n > 0 ? SEVERITY[s].rail : "var(--grid)" }}
            />
            <div className="pl-2">
              <div className="text-xs font-medium text-ink-secondary">
                {SEVERITY[s].label}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={`text-2xl font-semibold leading-none ${n > 0 ? SEVERITY[s].text : "text-ink-muted"}`}
                >
                  {n}
                </span>
                {delta !== null && delta !== 0 && (
                  <span className="tnum text-xs text-ink-muted">
                    {delta > 0 ? `+${delta}` : delta} vs last
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {change !== null && (
        <p className="text-xs text-ink-muted sm:col-span-2 xl:col-span-4">
          {change === 0
            ? `Same number of findings as the previous audit (${total}).`
            : change < 0
              ? `${Math.abs(change)} fewer findings than the previous audit.`
              : `${change} more findings than the previous audit.`}
        </p>
      )}
    </div>
  );
}

/**
 * Core Web Vitals as three status readouts.
 *
 * Deliberately not a chart: three numbers against three fixed thresholds is a
 * comparison a reader makes instantly from the value and the target printed
 * beside it. Each carries a written verdict as well as a colour.
 */
function CoreWebVitals({ cwv }: { cwv: NonNullable<AuditResult["cwv"]> }) {
  const metrics = [
    {
      key: "LCP",
      name: "Largest Contentful Paint",
      value: cwv.lcp,
      target: cwv.thresholds.lcp,
      format: (v: number) => `${(v / 1000).toFixed(1)}s`,
      hint: "How soon the main content appears",
    },
    {
      key: "INP",
      name: "Interaction to Next Paint",
      value: cwv.inp,
      target: cwv.thresholds.inp,
      format: (v: number) => `${Math.round(v)}ms`,
      hint: "How quickly the page responds to a tap",
    },
    {
      key: "CLS",
      name: "Cumulative Layout Shift",
      value: cwv.cls,
      target: cwv.thresholds.cls,
      format: (v: number) => v.toFixed(2),
      hint: "How much the layout jumps while loading",
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Core Web Vitals"
        subtitle={
          cwv.source === "field"
            ? "Measured from real visitors, 75th percentile over the last 28 days."
            : "Lab data only — no real-visitor data available for this site, and lab and field results diverge. Treat as directional."
        }
      />
      <div className="grid gap-px bg-hairline sm:grid-cols-3">
        {metrics.map((m) => {
          // INP has no field-quality equivalent in lab data, so it is not
          // judged when only lab numbers are available.
          const judged = !(cwv.source === "lab" && m.key === "INP");
          const pass = m.value <= m.target;
          return (
            <div key={m.key} className="bg-surface px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-ink-secondary">
                  {m.key}
                </span>
                {judged && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      pass ? "text-good-text" : "text-critical"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        background: pass ? "var(--good)" : "var(--critical)",
                      }}
                    />
                    {pass ? "Pass" : "Fail"}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-2xl font-semibold leading-none text-ink">
                {m.format(m.value)}
              </div>
              <div className="tnum mt-1 text-[11px] text-ink-muted">
                target ≤ {m.format(m.target)}
              </div>
              <div className="mt-1.5 text-xs leading-snug text-ink-secondary">
                {m.name}
                <span className="block text-ink-muted">{m.hint}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FindingList({
  title,
  subtitle,
  findings,
}: {
  title: string;
  subtitle: string;
  findings: AuditFinding[];
}) {
  if (findings.length === 0) return null;
  const sorted = [...findings].sort(
    (a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order,
  );

  return (
    <Card>
      <CardHeader title={`${title} (${findings.length})`} subtitle={subtitle} />
      <ul className="divide-y divide-hairline">
        {sorted.map((f) => (
          <li key={f.id} className="relative py-3 pl-5 pr-4">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: SEVERITY[f.severity].rail }}
            />
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide ${SEVERITY[f.severity].text}`}
                  >
                    {SEVERITY[f.severity].label}
                  </span>
                  <h3 className="text-sm font-medium text-ink">{f.title}</h3>
                </div>
                <p className="mt-1 text-sm leading-snug text-ink-secondary">
                  {f.detail}
                </p>
                {f.evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-l border-hairline pl-2.5">
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
              <span className="shrink-0 rounded-md bg-page px-2 py-0.5 text-[11px] text-ink-secondary">
                {f.effort}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
