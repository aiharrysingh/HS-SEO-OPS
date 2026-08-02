import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getClientPerformance } from "@/lib/metrics";
import { isSyncActive } from "@/lib/gsc";
import { formatDate } from "@/lib/dates";
import { compact, full, percent, position } from "@/lib/format";
import { DataCutoff, SyncStatus } from "@/components/DataCutoff";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { PagesTable } from "@/components/PagesTable";
import { SyncButton } from "@/components/SyncButton";
import { Card, CardHeader, EmptyState, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "90 days" },
];

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { clientId } = await params;
  const { days: daysParam } = await searchParams;

  const days = WINDOWS.some((w) => String(w.days) === daysParam)
    ? Number(daysParam)
    : 28;
  const windowLabel =
    WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`;

  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) notFound();

  const perf = await getClientPerformance(clientId, days);
  const initiallySyncing = isSyncActive(client.syncStartedAt);

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

        <div className="flex items-center gap-2">
          <WindowSwitcher clientId={clientId} active={days} />
          <Link
            href={`/clients/${clientId}/reports`}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
          >
            Reports
          </Link>
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
          Add pages to the <code className="font-mono">pages</code> table, then
          run a sync to pull their Search Console metrics.
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
              comparisonLabel={`vs previous ${windowLabel}`}
            />
            <StatTile
              label="Impressions"
              value={compact(perf.totals.impressions)}
              current={perf.totals.impressions}
              previous={perf.previousTotals.impressions}
              spark={perf.daily.map((d) => d.impressions)}
              comparisonLabel={`vs previous ${windowLabel}`}
            />
            <StatTile
              label="Click-through rate"
              value={percent(perf.totals.ctr, 2)}
              current={perf.totals.ctr}
              previous={perf.previousTotals.ctr}
              comparisonLabel={`vs previous ${windowLabel}`}
            />
            <StatTile
              label="Average position"
              value={position(perf.totals.position)}
              current={perf.totals.position ?? 0}
              previous={perf.previousTotals.position ?? 0}
              lowerIsBetter
              unit="places"
              comparisonLabel={`vs previous ${windowLabel}`}
            />
          </div>

          {/* Two measures, two charts. A shared plot with two y-scales would
              invent a relationship between them. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Daily clicks"
                subtitle={`${formatDate(perf.window.start)} – ${formatDate(perf.window.end)}`}
              />
              <div className="px-3 py-3">
                <TimeSeriesChart
                  points={perf.daily.map((d) => ({
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
                subtitle={`${formatDate(perf.window.start)} – ${formatDate(perf.window.end)}`}
              />
              <div className="px-3 py-3">
                <TimeSeriesChart
                  points={perf.daily.map((d) => ({
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

          <PagesTable
            clientId={clientId}
            pages={perf.pages}
            windowLabel={`Last ${windowLabel}`}
          />
        </>
      )}
    </div>
  );
}

function WindowSwitcher({
  clientId,
  active,
}: {
  clientId: string;
  active: number;
}) {
  return (
    <div className="inline-flex rounded-lg border border-hairline bg-page p-0.5">
      {WINDOWS.map((w) => (
        <Link
          key={w.days}
          href={`/clients/${clientId}?days=${w.days}`}
          scroll={false}
          aria-current={active === w.days ? "true" : undefined}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            active === w.days
              ? "bg-surface font-medium text-ink shadow-sm"
              : "text-ink-secondary hover:text-ink"
          }`}
        >
          {w.label}
        </Link>
      ))}
    </div>
  );
}
