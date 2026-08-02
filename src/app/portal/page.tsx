import { requirePortalViewer } from "@/lib/clientPortal";
import { getClientPerformance } from "@/lib/metrics";
import { RANGE_PRESETS, isTrailingWindow, parseWindow, windowLabel as describeWindow, daysBetween, dataCutoff, formatDate } from "@/lib/dates";
import { compact, full, percent, position } from "@/lib/format";
import { DataCutoff } from "@/components/DataCutoff";
import { DateRangePicker } from "@/components/DateRangePicker";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { Card, CardHeader, EmptyState, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const viewer = await requirePortalViewer();

  const sp = await searchParams;
  const window = parseWindow(sp);
  const rangeDays = daysBetween(window.start, window.end) + 1;
  const comparisonLabel = `vs previous ${rangeDays} days`;
  const activePreset =
    RANGE_PRESETS.find((p) => isTrailingWindow(window, p.days))?.days ?? null;

  // Scoped from the session, never a URL parameter.
  const perf = await getClientPerformance(viewer.clientId, window);

  const topPages = [...perf.pages]
    .sort((a, b) => b.current.clicks - a.current.clicks)
    .slice(0, 15);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Search performance
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {describeWindow(window)} of organic search from Google.
          </p>
          <DataCutoff cutoff={perf.cutoff} className="mt-2" />
        </div>
        <DateRangePicker
          window={perf.window}
          cutoff={dataCutoff()}
          presets={RANGE_PRESETS}
          activePreset={activePreset}
        />
      </header>

      {perf.pages.length === 0 ? (
        <EmptyState title="No performance data yet">
          Your pages are still being set up. This will fill in once tracking
          starts.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Clicks"
              value={full(perf.totals.clicks)}
              current={perf.totals.clicks}
              previous={perf.previousTotals.clicks}
              spark={perf.daily.map((d) => d.clicks)}
              comparisonLabel={comparisonLabel}
            />
            <StatTile
              label="Impressions"
              value={compact(perf.totals.impressions)}
              current={perf.totals.impressions}
              previous={perf.previousTotals.impressions}
              spark={perf.daily.map((d) => d.impressions)}
              comparisonLabel={comparisonLabel}
            />
            <StatTile
              label="Click-through rate"
              value={percent(perf.totals.ctr, 2)}
              current={perf.totals.ctr}
              previous={perf.previousTotals.ctr}
              comparisonLabel={comparisonLabel}
            />
            <StatTile
              label="Average position"
              value={position(perf.totals.position)}
              current={perf.totals.position ?? 0}
              previous={perf.previousTotals.position ?? 0}
              lowerIsBetter
              unit="places"
              comparisonLabel={comparisonLabel}
            />
          </div>

          <Card>
            <CardHeader
              title="Daily clicks"
              subtitle={`${formatDate(perf.window.start)} – ${formatDate(perf.window.end)}`}
            />
            <div className="px-3 py-3">
              <TimeSeriesChart
                points={perf.daily.map((d) => ({ date: d.date, value: d.clicks }))}
                label="Daily organic clicks"
                valueLabel="clicks"
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Your pages"
              subtitle="Ranked by clicks in this period."
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                    <th scope="col" className="px-4 py-2 font-medium">Page</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Clicks</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Impressions</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">CTR</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-hairline last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{p.title}</div>
                        <div className="truncate text-xs text-ink-muted">{p.path}</div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-medium text-ink">
                        {full(p.current.clicks)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                        {compact(p.current.impressions)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                        {percent(p.current.ctr)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-ink-secondary">
                        {position(p.current.position)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
