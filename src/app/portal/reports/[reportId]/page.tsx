import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalReport, requirePortalViewer } from "@/lib/clientPortal";
import { formatDate } from "@/lib/dates";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function PortalReport({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const viewer = await requirePortalViewer();

  const { reportId } = await params;
  // The lookup is scoped to this viewer's client and to published statuses, so
  // a guessed id from another client simply doesn't resolve.
  const report = await getPortalReport(viewer, reportId);
  if (!report) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/portal/reports"
          className="text-xs text-ink-secondary hover:underline"
        >
          ← All reports
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {report.cadence === "weekly" ? "Weekly" : "Monthly"} report
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
        </p>
      </div>

      <article
        className="report-prose rounded-xl border border-hairline bg-surface px-5 py-4"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
      />

      <p className="text-xs text-ink-muted">
        Figures come from Google Search Console, which publishes about three
        days behind.
      </p>
    </div>
  );
}
