import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReport } from "@/lib/reports";
import { renderMarkdown } from "@/lib/markdown";
import { formatDate } from "@/lib/dates";
import { GSC_LAG_DAYS } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}): Promise<Metadata> {
  const { reportId } = await params;
  const row = await getReport(reportId);
  if (!row) return { title: "Report" };
  return {
    title: `${row.client.name} — SEO performance ${row.report.periodEnd}`,
  };
}

/**
 * The client-facing export.
 *
 * Deliberately outside the app shell: no sidebar, no navigation, no internal
 * controls. Printing this page is the PDF path — a server-side renderer would
 * mean shipping a headless browser, which is a lot of infrastructure for
 * something the browser already does well.
 */
export default async function ExportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const row = await getReport(reportId);
  if (!row) notFound();

  const { report, client } = row;
  const accent = client.branding?.primaryColor ?? "#2a78d6";

  return (
    <div className="export-root" style={{ ["--accent" as string]: accent }}>
      <div className="export-sheet">
        <header className="export-header">
          <div>
            {client.branding?.logoUrl ? (
              // Client logos are arbitrary remote URLs; next/image would need
              // each host allow-listed, and this page is print-first.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.branding.logoUrl}
                alt={client.name}
                className="export-logo"
              />
            ) : (
              <div className="export-wordmark">{client.name}</div>
            )}
            <div className="export-domain">{client.domain}</div>
          </div>
          <div className="export-period">
            <div className="export-period-label">
              {report.cadence === "weekly" ? "Weekly" : "Monthly"} report
            </div>
            <div className="export-period-dates">
              {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
            </div>
            {report.status === "draft" && (
              <div className="export-draft">Draft — not yet approved</div>
            )}
          </div>
        </header>

        <article
          className="report-prose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
        />

        <footer className="export-footer">
          Search Console data is complete to {report.periodEnd}; Google publishes{" "}
          {GSC_LAG_DAYS} days behind, so the final days of any calendar period
          are not included.
          {report.referenceDate
            ? ` SEO reference facts dated ${report.referenceDate}.`
            : ""}
        </footer>

        <div className="export-actions">
          <button type="button" data-print className="export-print">
            Print / Save as PDF
          </button>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelector('[data-print]')?.addEventListener('click',()=>window.print())`,
        }}
      />
    </div>
  );
}
