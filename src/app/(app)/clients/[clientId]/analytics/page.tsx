import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  RANGE_PRESETS,
  dataCutoff,
  daysBetween,
  formatDate,
  isTrailingWindow,
  parseWindow,
  withFilters,
} from "@/lib/dates";
import { countriesLabel, countryName, parseCountries } from "@/lib/countries";
import { getCountryBreakdown } from "@/lib/metrics";
import {
  Ga4ConfigError,
  ga4ByChannel,
  ga4BySource,
  ga4Scorecard,
  type Ga4ChannelRow,
  type Ga4SourceRow,
  type Ga4Totals,
} from "@/lib/ga4";
import { compact, delta, full, percent } from "@/lib/format";
import { DateRangePicker } from "@/components/DateRangePicker";
import { CountryFilter } from "@/components/CountryFilter";
import {
  Card,
  CardHeader,
  DeltaBadge,
  EmptyState,
  StatTile,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * GA4 returns seconds. Formatted h:mm:ss to match what the GA4 UI shows, so a
 * figure checked against Google reads identically rather than as "81:12".
 */
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${sec}`
    : `${m}:${sec}`;
}

export default async function AnalyticsPage({
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
  const rangeDays = daysBetween(window.start, window.end) + 1;
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

  // Country options come from Search Console's country data — GA4 has its own
  // country dimension, but reusing one list keeps the filter consistent across
  // both screens rather than offering two subtly different sets.
  const countryRows = await getCountryBreakdown(clientId, window);
  const countryOptions = countryRows.map((r) => ({
    code: r.country,
    name: countryName(r.country),
    clicks: r.current.clicks,
  }));

  let scorecard: { current: Ga4Totals; previous: Ga4Totals } | null = null;
  let channels: {
    current: Ga4ChannelRow[];
    previous: Map<string, Ga4ChannelRow>;
  } | null = null;
  let sources: Ga4SourceRow[] = [];
  let error: string | null = null;

  if (client.ga4PropertyId) {
    try {
      [scorecard, channels, sources] = await Promise.all([
        ga4Scorecard(client, window, countries),
        ga4ByChannel(client, window, countries),
        ga4BySource(client, window, countries),
      ]);
    } catch (err) {
      error =
        err instanceof Ga4ConfigError
          ? err.message
          : `Could not read Google Analytics: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link
          href={withFilters(`/clients/${clientId}`, window, {
            country: sp.country,
          })}
          className="text-xs text-ink-secondary hover:underline"
        >
          ← {client.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {formatDate(window.start)} – {formatDate(window.end)}
          {countries.length > 0 && ` · ${countriesLabel(countries)}`}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Read live from Google Analytics, so these figures are current rather
          than lagged like Search Console.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          window={window}
          cutoff={dataCutoff()}
          presets={RANGE_PRESETS}
          activePreset={activePreset}
        />
        <CountryFilter
          options={countryOptions}
          selected={countries}
          label={countriesLabel(countries)}
        />
      </div>
    </header>
  );

  if (!client.ga4PropertyId) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="No Google Analytics property linked">
          <p>
            Link a GA4 property to {client.name} on the{" "}
            <Link href="/account" className="text-ink underline">
              Account
            </Link>{" "}
            screen to see users, sessions and traffic sources here.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <div className="rounded-xl border border-hairline bg-wash-critical px-4 py-3">
          <p className="text-sm font-medium text-critical">
            Could not load Google Analytics
          </p>
          <p className="mt-0.5 text-xs leading-snug text-ink-secondary">
            {error}
          </p>
        </div>
      )}

      {scorecard && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label="Total users"
            value={full(scorecard.current.users)}
            current={scorecard.current.users}
            previous={scorecard.previous.users}
            comparisonLabel={comparisonLabel}
          />
          <StatTile
            label="New users"
            value={full(scorecard.current.newUsers)}
            current={scorecard.current.newUsers}
            previous={scorecard.previous.newUsers}
            comparisonLabel={comparisonLabel}
          />
          <StatTile
            label="Sessions"
            value={full(scorecard.current.sessions)}
            current={scorecard.current.sessions}
            previous={scorecard.previous.sessions}
            comparisonLabel={comparisonLabel}
          />
          <StatTile
            label="Bounce rate"
            value={percent(scorecard.current.bounceRate, 2)}
            current={scorecard.current.bounceRate}
            previous={scorecard.previous.bounceRate}
            lowerIsBetter
            comparisonLabel={comparisonLabel}
          />
          <StatTile
            label="Avg session duration"
            value={duration(scorecard.current.avgSessionDuration)}
            current={scorecard.current.avgSessionDuration}
            previous={scorecard.previous.avgSessionDuration}
            comparisonLabel={comparisonLabel}
          />
        </div>
      )}

      {channels && channels.current.length > 0 && (
        <Card>
          <CardHeader
            title="Traffic by channel"
            subtitle="Sessions grouped by how the visit started."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Channel
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    vs prev
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    New users
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    vs prev
                  </th>
                </tr>
              </thead>
              <tbody>
                {channels.current.map((r) => {
                  const prev = channels.previous.get(r.channel);
                  return (
                    <tr
                      key={r.channel}
                      className="border-b border-hairline last:border-0 hover:bg-page"
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {r.channel}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink">
                        {full(r.sessions)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge d={delta(r.sessions, prev?.sessions ?? 0)} />
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                        {full(r.newUsers)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeltaBadge d={delta(r.newUsers, prev?.newUsers ?? 0)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sources.length > 0 && (
        <Card>
          <CardHeader
            title="Traffic by source and landing page"
            subtitle={`Top ${sources.length} by sessions.`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Channel
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Landing page
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Users
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    New users
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Sessions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((r, i) => (
                  <tr
                    key={`${r.channel}|${r.source}|${r.landingPage}|${i}`}
                    className="border-b border-hairline last:border-0 hover:bg-page"
                  >
                    <td className="px-4 py-2.5 text-ink-secondary">{r.channel}</td>
                    <td className="px-3 py-2.5 text-ink-secondary">{r.source}</td>
                    <td className="max-w-[320px] truncate px-3 py-2.5 text-ink">
                      {r.landingPage}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {compact(r.users)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {compact(r.newUsers)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-medium text-ink">
                      {compact(r.sessions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!error && scorecard && scorecard.current.sessions === 0 && (
        <EmptyState title="No Analytics data in this window">
          The property is linked, but Google Analytics reports no sessions for
          this date range{countries.length > 0 && " and country selection"}.
        </EmptyState>
      )}
    </div>
  );
}
