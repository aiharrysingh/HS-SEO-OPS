import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  getClientPerformance,
  getCountryBreakdown,
  getCountryPerformance,
} from "@/lib/metrics";
import { isSyncActive } from "@/lib/gsc";
import { countriesLabel, countryName, parseCountries } from "@/lib/countries";
import {
  RANGE_PRESETS,
  daysBetween,
  formatDate,
  isTrailingWindow,
  parseWindow,
  windowLabel as describeWindow,
  withFilters,
} from "@/lib/dates";
import { compact, delta, full, percent, position } from "@/lib/format";
import { DataCutoff, SyncStatus } from "@/components/DataCutoff";
import { DateRangePicker } from "@/components/DateRangePicker";
import { CountryFilter } from "@/components/CountryFilter";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { PagesTable } from "@/components/PagesTable";
import { SyncButton } from "@/components/SyncButton";
import { ImportPagesButton } from "@/components/ImportPagesButton";
import {
  Card,
  CardHeader,
  DeltaBadge,
  EmptyState,
  StatTile,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    days?: string;
    from?: string;
    to?: string;
    country?: string;
  }>;
}) {
  const { clientId } = await params;
  const sp = await searchParams;

  const window = parseWindow(sp);
  const countries = parseCountries(sp.country);
  const windowLabel = describeWindow(window);
  const rangeDays = daysBetween(window.start, window.end) + 1;
  // Always stated in days: "vs previous Last 28 days" reads badly, and for a
  // custom range the reader needs to know how long the comparison period is.
  const comparisonLabel = `vs previous ${rangeDays} days`;
  const activePreset =
    RANGE_PRESETS.find((p) => isTrailingWindow(window, p.days))?.days ?? null;

  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) notFound();

  const [perf, countryRows] = await Promise.all([
    getClientPerformance(clientId, window),
    getCountryBreakdown(clientId, window),
  ]);
  const initiallySyncing = isSyncActive(client.syncStartedAt);

  /**
   * With countries selected the headline figures switch to GSC's property-wide
   * country totals, because that is the only place country data exists. That
   * is a *different basis* from the unfiltered view, which sums this client's
   * tracked pages — so the labels below change too. Swapping the basis
   * silently would move every number for a reason the reader cannot see.
   */
  const filtered = countries.length > 0;
  const countryPerf = filtered
    ? await getCountryPerformance(clientId, window, countries)
    : null;

  const totals = countryPerf?.totals ?? perf.totals;
  const previousTotals = countryPerf?.previousTotals ?? perf.previousTotals;
  const daily = countryPerf?.daily ?? perf.daily;
  const basisNote = filtered
    ? `${countriesLabel(countries)} · site-wide`
    : "Tracked pages";

  const countryOptions = countryRows.map((r) => ({
    code: r.country,
    name: countryName(r.country),
    clicks: r.current.clicks,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {client.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
            <a
              href={`https://${client.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {client.domain}
            </a>
            <span className="text-ink-muted">·</span>
            <SyncStatus
              ageHours={
                client.lastSyncedAt
                  ? (perf.now - client.lastSyncedAt.getTime()) / 3_600_000
                  : null
              }
              lastSyncError={client.lastSyncError}
            />
          </div>
          <DataCutoff cutoff={perf.cutoff} className="mt-2" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            window={perf.window}
            cutoff={perf.cutoff}
            presets={RANGE_PRESETS}
            activePreset={activePreset}
          />
          <CountryFilter
            options={countryOptions}
            selected={countries}
            label={countriesLabel(countries)}
          />
          <Link
            href={withFilters(`/clients/${clientId}/analytics`, window, {
              country: sp.country,
            })}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
          >
            Analytics
          </Link>
          <Link
            href={withFilters(`/clients/${clientId}/reports`, window, {
              country: sp.country,
            })}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
          >
            Reports
          </Link>
          <ImportPagesButton clientId={clientId} />
          <SyncButton
            clientId={clientId}
            initiallySyncing={initiallySyncing}
            syncStartedAt={initiallySyncing ? client.syncStartedAt!.toISOString() : null}
            isFirstSync={client.lastSyncedAt === null}
          />
        </div>
      </header>

      {client.lastSyncError && (
        <div className="rounded-xl border border-hairline bg-wash-critical px-4 py-3">
          <p className="text-sm font-medium text-critical">
            Last Search Console sync failed
          </p>
          <p className="mt-0.5 font-mono text-xs text-ink-secondary">
            {client.lastSyncError}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Figures below are from the last successful pull and may be out of
            date.
          </p>
        </div>
      )}

      {perf.pages.length === 0 ? (
        <EmptyState title="No pages tracked for this client yet">
          <p>
            Search Console reports traffic per URL, but pages are tracked
            deliberately rather than created automatically — a publish date and
            target keyword are curated, not derivable.
          </p>
          <p className="mt-2">
            <strong className="font-medium text-ink">Import pages</strong> creates
            them from the URLs Search Console already knows about, then{" "}
            <strong className="font-medium text-ink">Sync now</strong> fills in
            their metrics.
          </p>
        </EmptyState>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs text-ink-muted">
              Basis: <span className="text-ink-secondary">{basisNote}</span>
              {filtered && (
                <>
                  {" — "}country data is only available site-wide, so these
                  cover the whole property, not just tracked pages.
                </>
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Clicks"
                value={full(totals.clicks)}
                current={totals.clicks}
                previous={previousTotals.clicks}
                spark={daily.map((d) => d.clicks)}
                comparisonLabel={comparisonLabel}
              />
              <StatTile
                label="Impressions"
                value={compact(totals.impressions)}
                current={totals.impressions}
                previous={previousTotals.impressions}
                spark={daily.map((d) => d.impressions)}
                comparisonLabel={comparisonLabel}
              />
              <StatTile
                label="Click-through rate"
                value={percent(totals.ctr, 2)}
                current={totals.ctr}
                previous={previousTotals.ctr}
                comparisonLabel={comparisonLabel}
              />
              <StatTile
                label="Average position"
                value={position(totals.position)}
                current={totals.position ?? 0}
                previous={previousTotals.position ?? 0}
                lowerIsBetter
                unit="places"
                comparisonLabel={comparisonLabel}
              />
            </div>
          </div>

          {/* Two measures, two charts. A shared plot with two y-scales would
              invent a relationship between them. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Daily clicks"
                subtitle={`${formatDate(perf.window.start)} – ${formatDate(perf.window.end)} · ${basisNote}`}
              />
              <div className="px-3 py-3">
                <TimeSeriesChart
                  points={daily.map((d) => ({
                    date: d.date,
                    value: d.clicks,
                  }))}
                  label={`Daily organic clicks for ${client.name}`}
                  valueLabel="clicks"
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Daily impressions"
                subtitle={`${formatDate(perf.window.start)} – ${formatDate(perf.window.end)} · ${basisNote}`}
              />
              <div className="px-3 py-3">
                <TimeSeriesChart
                  points={daily.map((d) => ({
                    date: d.date,
                    value: d.impressions,
                  }))}
                  color="var(--series-2)"
                  wash="var(--wash-2)"
                  label={`Daily impressions for ${client.name}`}
                  valueLabel="impressions"
                />
              </div>
            </Card>
          </div>

          {countryRows.length > 0 && (
            <Card>
              <CardHeader
                title="Traffic by country"
                subtitle={`Site-wide, ${formatDate(perf.window.start)} – ${formatDate(perf.window.end)}. Click a row to filter.`}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                      <th scope="col" className="px-4 py-2 font-medium">
                        Country
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Clicks
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        vs prev
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Impressions
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        CTR
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        Avg position
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {countryRows.slice(0, 12).map((r) => (
                      <tr
                        key={r.country}
                        className="border-b border-hairline last:border-0 hover:bg-page"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={withFilters(`/clients/${clientId}`, window, {
                              country: r.country,
                            })}
                            className="font-medium text-ink hover:underline"
                          >
                            {countryName(r.country)}
                          </Link>
                        </td>
                        <td className="tnum px-3 py-2.5 text-right font-medium text-ink">
                          {full(r.current.clicks)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <DeltaBadge
                            d={delta(r.current.clicks, r.previous.clicks)}
                          />
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                          {compact(r.current.impressions)}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                          {percent(r.current.ctr)}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-ink-secondary">
                          {position(r.current.position)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {countryRows.length > 12 && (
                <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
                  Showing the top 12 of {countryRows.length} countries. Use the
                  country filter for the rest.
                </p>
              )}
            </Card>
          )}

          {filtered && (
            <p className="rounded-xl border border-hairline bg-wash-warning px-4 py-3 text-xs text-ink-secondary">
              The page table below is <strong className="font-medium text-ink">not</strong>{" "}
              filtered by country. Search Console reports country totals for the
              whole site, not per page, so per-page figures cover all countries.
            </p>
          )}

          <PagesTable
            clientId={clientId}
            pages={perf.pages}
            windowLabel={windowLabel}
            window={perf.window}
          />
        </>
      )}
    </div>
  );
}

