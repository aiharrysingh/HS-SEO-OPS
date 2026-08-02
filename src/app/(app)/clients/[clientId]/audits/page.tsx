import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatDate, parseWindow, withFilters } from "@/lib/dates";
import type { AuditFinding, AuditResult, AuditSeverity } from "@/lib/audit";
import { RunAuditButton } from "@/components/RunAuditButton";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE: Record<AuditSeverity, "critical" | "warning" | "neutral" | "blue"> = {
  critical: "critical",
  serious: "warning",
  warning: "warning",
  info: "neutral",
};

export default async function AuditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const { clientId } = await params;
  const window = parseWindow(await searchParams);

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
  const quickWins = latest?.findings.filter((f) => f.bucket === "quick-win") ?? [];
  const strategic = latest?.findings.filter((f) => f.bucket === "strategic") ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={withFilters(`/clients/${clientId}`, window)}
            className="text-xs text-ink-secondary hover:underline"
          >
            ← {client.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
            Site audit
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Technical and on-page checks against {client.domain}, run on demand
            and stored so they are comparable over time.
          </p>
        </div>
        <RunAuditButton clientId={clientId} />
      </header>

      {!latest ? (
        <EmptyState title="No audit yet">
          <p>
            <strong className="font-medium text-ink">Run audit</strong> fetches
            robots.txt, the sitemap and a sample of pages, then checks
            crawlability, AI-crawler access, on-page basics and Core Web Vitals.
          </p>
        </EmptyState>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-ink-secondary">
                Last run {formatDate(latest.ranAt.slice(0, 10))} ·{" "}
                {latest.pagesSampled} pages sampled ·{" "}
                <span className="text-ink-muted">{latest.sources.join(" · ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={quickWins.length > 0 ? "warning" : "good"}>
                  {quickWins.length} quick win{quickWins.length === 1 ? "" : "s"}
                </Badge>
                <Badge tone="blue">{strategic.length} strategic</Badge>
              </div>
            </div>
            {latest.notRun.length > 0 && (
              <p className="mt-2 text-xs leading-snug text-ink-muted">
                <strong className="font-medium text-ink-secondary">Not checked:</strong>{" "}
                {latest.notRun.join(" · ")}
              </p>
            )}
          </Card>

          {latest.findings.length === 0 ? (
            <EmptyState title="Nothing flagged">
              Every check that ran came back clean. Anything listed under
              &ldquo;not checked&rdquo; above was not assessed either way.
            </EmptyState>
          ) : (
            <>
              <FindingList
                title="Quick wins"
                subtitle="Meaningful impact, low risk, under about a week of work."
                findings={quickWins}
              />
              <FindingList
                title="Strategic"
                subtitle="Larger effort or dev resource, higher payoff."
                findings={strategic}
              />
            </>
          )}

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
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                    >
                      <span className="text-ink-secondary">
                        {formatDate(res.ranAt.slice(0, 10))}
                      </span>
                      <span className="text-ink-muted">
                        {res.findings.length} finding
                        {res.findings.length === 1 ? "" : "s"} ·{" "}
                        {res.pagesSampled} pages sampled
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
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <ul className="divide-y divide-hairline">
        {findings.map((f) => (
          <li key={f.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[f.severity]}>{f.severity}</Badge>
                  <h3 className="text-sm font-medium text-ink">{f.title}</h3>
                </div>
                <p className="mt-1 text-sm leading-snug text-ink-secondary">
                  {f.detail}
                </p>
                {f.evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
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
              <span className="shrink-0 text-xs text-ink-muted">{f.effort}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
