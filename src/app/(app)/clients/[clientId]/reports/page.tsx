import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatDate } from "@/lib/dates";
import { listReports, reviewMinutes } from "@/lib/reports";
import { tryLoadCurrentState } from "@/lib/references";
import { GenerateReportButton } from "@/components/GenerateReportButton";
import { ReferenceState } from "@/components/ReferenceState";
import { Badge, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
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

  const [reports, refs] = await Promise.all([
    listReports(clientId),
    tryLoadCurrentState(),
  ]);

  const approved = reports
    .map((r) => reviewMinutes(r))
    .filter((m): m is number => m !== null);
  const medianReview =
    approved.length > 0
      ? approved.sort((a, b) => a - b)[Math.floor(approved.length / 2)]
      : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/clients/${clientId}`}
            className="text-xs text-ink-secondary hover:underline"
          >
            ← {client.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
            Reports
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Drafted from Search Console data against the{" "}
            <code className="font-mono text-xs">client-report</code> standard.
            Every draft needs a human pass before it goes out.
          </p>
        </div>
        <GenerateReportButton clientId={clientId} />
      </header>

      <ReferenceState refs={refs} />

      {medianReview !== null && (
        <Card className="px-4 py-3">
          <div className="text-xs font-medium text-ink-secondary">
            Median time from draft to approved
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold leading-none text-ink">
              {medianReview} min
            </span>
            <span className="text-xs text-ink-muted">
              across {approved.length}{" "}
              {approved.length === 1 ? "report" : "reports"} · elapsed time, not
              attention — a proxy for plan §9&apos;s target of under 15 minutes
            </span>
          </div>
        </Card>
      )}

      {reports.length === 0 ? (
        <EmptyState title="No reports yet">
          Generate a weekly or monthly draft above. Drafts are computed from the
          stored Search Console data, so they appear immediately and the same
          data always produces the same report.
        </EmptyState>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Reports for {client.name}</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                  <th scope="col" className="px-4 py-2 font-medium">Period</th>
                  <th scope="col" className="px-3 py-2 font-medium">Cadence</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Generated</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Draft → approved
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">Facts dated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const mins = reviewMinutes(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-hairline last:border-0 hover:bg-page"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/clients/${clientId}/reports/${r.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-ink-secondary">
                        {r.cadence}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          tone={
                            r.status === "draft"
                              ? "warning"
                              : r.status === "sent"
                                ? "blue"
                                : "good"
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="tnum px-3 py-2.5 text-ink-secondary">
                        {r.generatedAt
                          ? r.generatedAt.toLocaleDateString("en-GB")
                          : "—"}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                        {mins === null ? "—" : `${mins} min`}
                      </td>
                      <td className="tnum px-4 py-2.5 text-ink-secondary">
                        {r.referenceDate ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
