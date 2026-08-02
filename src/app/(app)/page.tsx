import Link from "next/link";
import { getClientSummaries } from "@/lib/metrics";
import {
  RANGE_PRESETS,
  dataCutoff,
  daysBetween,
  isTrailingWindow,
  parseWindow,
  windowLabel as describeWindow,
  withFilters,
} from "@/lib/dates";
import { compact, delta, full, percent, position } from "@/lib/format";
import { DataCutoff, SyncStatus } from "@/components/DataCutoff";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Sparkline } from "@/components/Sparkline";
import { Card, DeltaBadge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const window = parseWindow(sp);
  const cutoff = dataCutoff();
  const summaries = await getClientSummaries(window);

  const windowLabel = describeWindow(window);
  const rangeDays = daysBetween(window.start, window.end) + 1;
  const activePreset =
    RANGE_PRESETS.find((p) => isTrailingWindow(window, p.days))?.days ?? null;

  const totals = summaries.reduce(
    (acc, s) => ({
      clicks: acc.clicks + s.current.clicks,
      previousClicks: acc.previousClicks + s.previous.clicks,
      impressions: acc.impressions + s.current.impressions,
      pages: acc.pages + s.pageCount,
    }),
    { clicks: 0, previousClicks: 0, impressions: 0, pages: 0 },
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Portfolio
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {windowLabel} across {summaries.length}{" "}
            {summaries.length === 1 ? "client" : "clients"} and{" "}
            {full(totals.pages)} tracked pages.
          </p>
          <DataCutoff cutoff={cutoff} className="mt-2" />
        </div>
        <DateRangePicker
          window={window}
          cutoff={cutoff}
          presets={RANGE_PRESETS}
          activePreset={activePreset}
        />
      </header>

      {summaries.length === 0 ? (
        <EmptyState title="No clients yet">
          Add a client and its Search Console property, then run a sync. For
          demo data, run <code className="font-mono">npm run db:seed</code>.
        </EmptyState>
      ) : (
        <>
          {/* Hero figure — exactly one per view. */}
          <Card className="px-5 py-5">
            <div className="text-xs font-medium text-ink-secondary">
              Organic clicks, all clients
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="text-5xl font-semibold leading-none tracking-tight text-ink">
                {full(totals.clicks)}
              </div>
              <div className="flex items-center gap-1.5 pb-1">
                <DeltaBadge d={delta(totals.clicks, totals.previousClicks)} />
                <span className="text-xs text-ink-muted">
                  vs previous {rangeDays} days ({full(totals.previousClicks)})
                </span>
              </div>
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              {full(totals.impressions)} impressions · {window.start} to{" "}
              {window.end}
            </div>
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">
                  Organic performance by client, {window.start} to {window.end}
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                    <Th className="pl-4">Client</Th>
                    <Th align="right">Pages</Th>
                    <Th align="right">Clicks</Th>
                    <Th align="right">vs prev</Th>
                    <Th align="right">Impressions</Th>
                    <Th align="right">CTR</Th>
                    <Th align="right">Avg position</Th>
                    <Th>Trend</Th>
                    <Th className="pr-4">Sync</Th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-hairline last:border-0 hover:bg-page"
                    >
                      <td className="py-2.5 pl-4 pr-3">
                        <Link
                          href={withFilters(`/clients/${s.id}`, window)}
                          className="font-medium text-ink hover:underline"
                        >
                          {s.name}
                        </Link>
                        <div className="text-xs text-ink-muted">{s.domain}</div>
                      </td>
                      <Td align="right">{s.pageCount}</Td>
                      <Td align="right" strong>
                        {full(s.current.clicks)}
                      </Td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge d={delta(s.current.clicks, s.previous.clicks)} />
                      </td>
                      <Td align="right">{compact(s.current.impressions)}</Td>
                      <Td align="right">{percent(s.current.ctr)}</Td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="tnum">
                          {position(s.current.position)}
                        </span>
                        <div>
                          <DeltaBadge
                            d={delta(
                              s.current.position ?? 0,
                              s.previous.position ?? 0,
                            )}
                            lowerIsBetter
                            unit="places"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Sparkline
                          values={s.daily}
                          title={`${s.name} daily clicks`}
                        />
                      </td>
                      <td className="py-2.5 pl-3 pr-4">
                        <SyncStatus
                          ageHours={s.syncAgeHours}
                          lastSyncError={s.lastSyncError}
                        />
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

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  strong = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  strong?: boolean;
}) {
  return (
    <td
      className={`tnum px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${
        strong ? "font-medium text-ink" : "text-ink-secondary"
      }`}
    >
      {children}
    </td>
  );
}
