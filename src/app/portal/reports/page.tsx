import Link from "next/link";
import { getPortalReports, requirePortalViewer } from "@/lib/clientPortal";
import { formatDate } from "@/lib/dates";
import { Badge, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PortalReports() {
  const viewer = await requirePortalViewer();

  // Drafts are excluded at the query — see clientPortal.ts.
  const reports = await getPortalReports(viewer);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Reports</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Your published performance reports, most recent first.
        </p>
      </header>

      {reports.length === 0 ? (
        <EmptyState title="No reports published yet">
          Reports appear here once your account manager has reviewed and
          published them.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-hairline">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/portal/reports/${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-page"
                >
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {r.cadence === "weekly" ? "Weekly" : "Monthly"} report
                      {r.approvedAt &&
                        ` · published ${formatDate(r.approvedAt.toISOString().slice(0, 10))}`}
                    </div>
                  </div>
                  <Badge tone={r.status === "sent" ? "blue" : "good"}>
                    {r.status === "sent" ? "Sent" : "Published"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
