import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageDetail } from "@/lib/metrics";
import {
  MILESTONES,
  RANGE_PRESETS,
  daysBetween,
  formatDate,
  isTrailingWindow,
  parseWindow,
  windowLabel as describeWindow,
  withFilters,
} from "@/lib/dates";
import { compact, full, percent, position } from "@/lib/format";
import { DataCutoff } from "@/components/DataCutoff";
import { DateRangePicker } from "@/components/DateRangePicker";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { Badge, Card, CardHeader, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; pageId: string }>;
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const { clientId, pageId } = await params;
  const sp = await searchParams;
  const window = parseWindow(sp);
  const detail = await getPageDetail(pageId, window);

  if (!detail || detail.page.clientId !== clientId) notFound();

  const { page, client } = detail;
  const windowLabel = describeWindow(window);
  const rangeDays = daysBetween(window.start, window.end) + 1;
  const activePreset =
    RANGE_PRESETS.find((p) => isTrailingWindow(window, p.days))?.days ?? null;

  return (
    <div className="space-y-6">
      <header className="relative">
        <div className="absolute right-0 top-0">
          <DateRangePicker
            window={detail.window}
            cutoff={detail.cutoff}
            presets={RANGE_PRESETS}
            activePreset={activePreset}
          />
        </div>

        <Link
          href={withFilters(`/clients/${clientId}`, window)}
          className="text-xs text-ink-secondary hover:underline"
        >
          ← {client.name}
        </Link>

        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {page.title}
        </h1>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge tone={page.type === "landing" ? "blue" : "neutral"}>
            {page.type}
          </Badge>
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-secondary hover:underline"
          >
            {page.url}
          </a>
        </div>

        <div className="mt-1.5 text-sm text-ink-secondary">
          {page.publishedAt ? (
            <>Published {formatDate(page.publishedAt)}</>
          ) : (
            <>No publish date recorded</>
          )}
          {page.targetKeyword && (
            <>
              {" · "}Target keyword:{" "}
              <span className="text-ink">{page.targetKeyword}</span>
            </>
          )}
        </div>

        <DataCutoff cutoff={detail.cutoff} className="mt-2" />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={`Clicks, ${windowLabel.toLowerCase()}`}
          value={full(detail.current.clicks)}
          current={detail.current.clicks}
          previous={detail.previous.clicks}
          comparisonLabel={`vs previous ${rangeDays} days`}
        />
        <StatTile
          label={`Impressions, ${windowLabel.toLowerCase()}`}
          value={compact(detail.current.impressions)}
          current={detail.current.impressions}
          previous={detail.previous.impressions}
          comparisonLabel={`vs previous ${rangeDays} days`}
        />
        <StatTile
          label="Average position"
          value={position(detail.current.position)}
          current={detail.current.position ?? 0}
          previous={detail.previous.position ?? 0}
          lowerIsBetter
          unit="places"
          comparisonLabel={`vs previous ${rangeDays} days`}
        />
        <StatTile
          label="Clicks since go-live"
          value={full(detail.lifetime.clicks)}
        />
      </div>

      <Card>
        <CardHeader
          title="Performance from go-live"
          subtitle="Cumulative clicks in the page's first 7, 30, 90 and 180 days — comparable across pages published at different times."
        />
        <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {detail.milestones.map((m) => {
            const spec = MILESTONES.find((x) => x.key === m.key)!;
            return (
              <div key={m.key} className="bg-surface px-4 py-3">
                <div className="text-xs font-medium text-ink-secondary">
                  {m.label}
                </div>
                {m.totals ? (
                  <>
                    <div className="mt-1 text-2xl font-semibold leading-none text-ink">
                      {full(m.totals.clicks)}
                    </div>
                    <div className="mt-1.5 text-xs text-ink-muted">
                      {compact(m.totals.impressions)} impressions ·{" "}
                      {percent(m.totals.ctr, 2)} CTR · pos{" "}
                      {position(m.totals.position)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-1 text-2xl font-semibold leading-none text-ink-muted">
                      —
                    </div>
                    <div className="mt-1.5 text-xs text-ink-muted">
                      Not reached yet — needs {spec.days} days live
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Clicks" subtitle="Every day since go-live" />
          <div className="px-3 py-3">
            <TimeSeriesChart
              points={detail.daily.map((d) => ({
                date: d.date,
                value: d.clicks,
              }))}
              label={`Daily clicks for ${page.title}`}
              valueLabel="clicks"
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Impressions"
            subtitle="Every day since go-live"
          />
          <div className="px-3 py-3">
            <TimeSeriesChart
              points={detail.daily.map((d) => ({
                date: d.date,
                value: d.impressions,
              }))}
              color="var(--series-2)"
              wash="var(--wash-2)"
              label={`Daily impressions for ${page.title}`}
              valueLabel="impressions"
              height={220}
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Daily detail"
          subtitle="The table view — every value the charts above plot."
        />
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                <th scope="col" className="px-4 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Clicks
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Impressions
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  CTR
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Position
                </th>
              </tr>
            </thead>
            <tbody>
              {[...detail.daily].reverse().map((d) => (
                <tr key={d.date} className="border-b border-hairline last:border-0">
                  <td className="tnum px-4 py-1.5 text-ink-secondary">
                    {d.date}
                  </td>
                  <td className="tnum px-3 py-1.5 text-right font-medium text-ink">
                    {d.clicks}
                  </td>
                  <td className="tnum px-3 py-1.5 text-right text-ink-secondary">
                    {full(d.impressions)}
                  </td>
                  <td className="tnum px-3 py-1.5 text-right text-ink-secondary">
                    {d.impressions > 0
                      ? percent(d.clicks / d.impressions, 2)
                      : "—"}
                  </td>
                  <td className="tnum px-4 py-1.5 text-right text-ink-secondary">
                    {d.position.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
