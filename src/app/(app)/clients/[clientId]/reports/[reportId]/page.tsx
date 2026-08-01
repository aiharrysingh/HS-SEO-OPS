import Link from "next/link";
import { notFound } from "next/navigation";
import { getReport } from "@/lib/reports";
import { renderMarkdown } from "@/lib/markdown";
import { formatDate } from "@/lib/dates";
import type { ReportInput } from "@/lib/reportData";
import { compact, full, percent, position } from "@/lib/format";
import { ReportEditor } from "@/components/ReportEditor";
import { Card, CardHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Snapshot = { input: ReportInput; usage?: Record<string, number> };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ clientId: string; reportId: string }>;
}) {
  const { clientId, reportId } = await params;
  const row = await getReport(reportId);
  if (!row || row.report.clientId !== clientId) notFound();

  const { report, client } = row;
  const snapshot = report.inputSnapshot as Snapshot | null;
  const input = snapshot?.input;

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/clients/${clientId}/reports`}
          className="text-xs text-ink-secondary hover:underline"
        >
          ← {client.name} reports
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {report.cadence === "weekly" ? "Weekly" : "Monthly"} report ·{" "}
          {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          {report.model ? `Drafted by ${report.model}` : "No model recorded"}
          {report.referenceDate
            ? ` · SEO facts dated ${report.referenceDate}`
            : ""}
          {report.generatedAt
            ? ` · generated ${report.generatedAt.toLocaleString("en-GB")}`
            : ""}
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ReportEditor
          reportId={report.id}
          initialContent={report.content}
          initialWorkDelivered={report.workDelivered}
          initialStatus={report.status}
          previewHtml={renderMarkdown(report.content)}
        />

        {input && (
          <aside className="space-y-4">
            <Card>
              <CardHeader
                title="Figures it was written from"
                subtitle="Stored with the report, so the prose can be checked against the numbers that produced it."
              />
              <div className="space-y-3 px-4 py-3 text-sm">
                <Segment label="All queries" cur={input.current.all} prev={input.previous.all} />
                <Segment label="Branded" cur={input.current.branded} prev={input.previous.branded} />
                <Segment
                  label="Non-branded"
                  cur={input.current.nonBranded}
                  prev={input.previous.nonBranded}
                />
              </div>
            </Card>

            {input.aiOverviewCandidates.length > 0 && (
              <Card>
                <CardHeader
                  title="AI Overview candidates"
                  subtitle="Impressions held, clicks fell, position barely moved. Evidence, not a verdict."
                />
                <ul className="space-y-2 px-4 py-3 text-xs">
                  {input.aiOverviewCandidates.slice(0, 5).map((q) => (
                    <li key={q.query}>
                      <span className="text-ink">{q.query}</span>
                      <div className="tnum text-ink-muted">
                        clicks {(q.clicksChangePct * 100).toFixed(0)}% ·
                        impressions {(q.impressionsChangePct * 100).toFixed(0)}% ·
                        position {q.positionChange >= 0 ? "+" : ""}
                        {q.positionChange.toFixed(1)}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {input.missingWindows.length > 0 && (
              <Card>
                <CardHeader title="Comparisons unavailable" />
                <ul className="space-y-1 px-4 py-3 text-xs text-ink-secondary">
                  {input.missingWindows.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Card>
            )}

            {snapshot?.usage && (
              <Card>
                <CardHeader title="Generation cost" />
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-xs">
                  {Object.entries(snapshot.usage).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-ink-muted">{humanise(k)}</dt>
                      <dd className="tnum text-right text-ink-secondary">
                        {full(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Segment({
  label,
  cur,
  prev,
}: {
  label: string;
  cur: ReportInput["current"]["all"];
  prev: ReportInput["previous"]["all"];
}) {
  return (
    <div className="border-b border-hairline pb-3 last:border-0 last:pb-0">
      <div className="text-xs font-medium text-ink-secondary">{label}</div>
      <div className="tnum mt-0.5 text-ink">
        {full(cur.clicks)} clicks{" "}
        <span className="text-xs text-ink-muted">
          (was {full(prev.clicks)})
        </span>
      </div>
      <div className="tnum text-xs text-ink-muted">
        {compact(cur.impressions)} impressions · {percent(cur.ctr, 2)} CTR · pos{" "}
        {position(cur.position)}
      </div>
    </div>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
