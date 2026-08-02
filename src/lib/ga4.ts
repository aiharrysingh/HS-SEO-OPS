import type { DateWindow } from "./dates";
import { previousWindow } from "./dates";
import { toAlpha2 } from "./countries";
import { GA4_SCOPE, resolveGoogleAuth, withTimeout } from "./googleAuth";

/**
 * Google Analytics 4, queried live rather than synced into tables.
 *
 * Search Console data is stored because the app needs it per page, per query
 * and per day for reports. GA4 is different: the dashboard slices it by
 * channel, source, landing page and country in whatever combination the user
 * picks, and pre-syncing every combination is a combinatorial explosion for
 * data the API will filter natively. So this reads through to GA4 on demand,
 * with a short cache to keep repeat page loads off the quota.
 *
 * The consequence, stated rather than hidden: these screens need connectivity
 * and are subject to GA4's per-property quota, and a report's stored snapshot
 * captures GA4 figures only as at generation time.
 */

const GA4_TIMEOUT_MS = 30_000;

/**
 * Cached long enough that a reload, a filter tweak and a back-button don't
 * each cost an API call, short enough that "today" still moves during a
 * working session. In-memory on purpose — same approach as `references.ts`,
 * and there is no second process to keep in step.
 */
const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

export class Ga4ConfigError extends Error {}

export function isGa4Configured(client: { ga4PropertyId: string | null }): boolean {
  return Boolean(client.ga4PropertyId);
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

type Ga4Client = {
  ga4PropertyId: string | null;
  ga4AuthUserId: string | null;
};

async function analyticsData(client: Ga4Client) {
  const auth = await resolveGoogleAuth(
    { authUserId: client.ga4AuthUserId, scope: GA4_SCOPE },
    () => {
      throw new Ga4ConfigError(
        "No Google Analytics access on file. Link a GA4 property on /account " +
          "with an account that can read it — and if you signed in before " +
          "Analytics support was added, sign out and back in so Google can " +
          "grant the new permission.",
      );
    },
  );
  const { google } = await import("googleapis");
  return google.analyticsdata({ version: "v1beta", auth });
}

/** Country filter, translated to the alpha-2 codes GA4's `countryId` expects. */
function countryFilter(countries: string[]) {
  const codes = countries
    .map(toAlpha2)
    .filter((c): c is string => Boolean(c));
  if (codes.length === 0) return undefined;
  return {
    filter: {
      fieldName: "countryId",
      inListFilter: { values: codes },
    },
  };
}

export type Ga4Totals = {
  users: number;
  newUsers: number;
  sessions: number;
  /** 0–1, like every other rate in this app. GA4 returns it that way already. */
  bounceRate: number;
  /** Seconds. */
  avgSessionDuration: number;
};

const EMPTY_TOTALS: Ga4Totals = {
  users: 0,
  newUsers: 0,
  sessions: 0,
  bounceRate: 0,
  avgSessionDuration: 0,
};

const SCORECARD_METRICS = [
  "totalUsers",
  "newUsers",
  "sessions",
  "bounceRate",
  "averageSessionDuration",
];

function readTotals(row: (string | null | undefined)[] | undefined): Ga4Totals {
  if (!row) return EMPTY_TOTALS;
  const n = (i: number) => Number(row[i] ?? 0) || 0;
  return {
    users: n(0),
    newUsers: n(1),
    sessions: n(2),
    bounceRate: n(3),
    avgSessionDuration: n(4),
  };
}

/** Headline numbers for the window, plus the preceding period for deltas. */
export async function ga4Scorecard(
  client: Ga4Client,
  window: DateWindow,
  countries: string[] = [],
): Promise<{ current: Ga4Totals; previous: Ga4Totals }> {
  const property = client.ga4PropertyId;
  if (!property) throw new Ga4ConfigError("No GA4 property linked for this client.");
  const prev = previousWindow(window);

  return cached(
    `scorecard|${property}|${window.start}|${window.end}|${countries.join(",")}`,
    async () => {
      const api = await analyticsData(client);
      const { data } = await withTimeout(
        api.properties.runReport({
          property,
          requestBody: {
            // Two ranges in one request rather than two round trips.
            dateRanges: [
              { startDate: window.start, endDate: window.end },
              { startDate: prev.start, endDate: prev.end },
            ],
            metrics: SCORECARD_METRICS.map((name) => ({ name })),
            dimensionFilter: countryFilter(countries),
          },
        }),
        GA4_TIMEOUT_MS,
        "Google Analytics did not respond in time.",
      );

      // With multiple dateRanges GA4 returns one row per range, tagged by a
      // synthetic `dateRange` dimension value ("date_range_0" / "_1").
      const rows = data.rows ?? [];
      const valuesFor = (i: number) =>
        rows[i]?.metricValues?.map((m) => m.value ?? "0");

      return {
        current: readTotals(valuesFor(0)),
        previous: readTotals(valuesFor(1)),
      };
    },
  );
}

export type Ga4ChannelRow = {
  channel: string;
  sessions: number;
  users: number;
  newUsers: number;
};

/** Sessions by default channel group — the "Traffic by Source" breakdown. */
export async function ga4ByChannel(
  client: Ga4Client,
  window: DateWindow,
  countries: string[] = [],
): Promise<{ current: Ga4ChannelRow[]; previous: Map<string, Ga4ChannelRow> }> {
  const property = client.ga4PropertyId;
  if (!property) throw new Ga4ConfigError("No GA4 property linked for this client.");
  const prev = previousWindow(window);

  return cached(
    `channel|${property}|${window.start}|${window.end}|${countries.join(",")}`,
    async () => {
      const api = await analyticsData(client);

      const run = (w: DateWindow) =>
        withTimeout(
          api.properties.runReport({
            property,
            requestBody: {
              dateRanges: [{ startDate: w.start, endDate: w.end }],
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [
                { name: "sessions" },
                { name: "totalUsers" },
                { name: "newUsers" },
              ],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              dimensionFilter: countryFilter(countries),
              limit: "50",
            },
          }),
          GA4_TIMEOUT_MS,
          "Google Analytics did not respond in time.",
        );

      const [now, before] = await Promise.all([run(window), run(prev)]);

      const parse = (res: typeof now): Ga4ChannelRow[] =>
        (res.data.rows ?? []).map((r) => ({
          channel: r.dimensionValues?.[0]?.value ?? "(not set)",
          sessions: Number(r.metricValues?.[0]?.value ?? 0) || 0,
          users: Number(r.metricValues?.[1]?.value ?? 0) || 0,
          newUsers: Number(r.metricValues?.[2]?.value ?? 0) || 0,
        }));

      return {
        current: parse(now),
        previous: new Map(parse(before).map((r) => [r.channel, r])),
      };
    },
  );
}

export type Ga4SourceRow = {
  channel: string;
  source: string;
  landingPage: string;
  users: number;
  newUsers: number;
  sessions: number;
};

/** Source × landing page detail — the bottom table in the reference screenshots. */
export async function ga4BySource(
  client: Ga4Client,
  window: DateWindow,
  countries: string[] = [],
  limit = 50,
): Promise<Ga4SourceRow[]> {
  const property = client.ga4PropertyId;
  if (!property) throw new Ga4ConfigError("No GA4 property linked for this client.");

  return cached(
    `source|${property}|${window.start}|${window.end}|${countries.join(",")}|${limit}`,
    async () => {
      const api = await analyticsData(client);
      const { data } = await withTimeout(
        api.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate: window.start, endDate: window.end }],
            dimensions: [
              { name: "sessionDefaultChannelGroup" },
              { name: "sessionSource" },
              { name: "landingPagePlusQueryString" },
            ],
            metrics: [
              { name: "totalUsers" },
              { name: "newUsers" },
              { name: "sessions" },
            ],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            dimensionFilter: countryFilter(countries),
            limit: String(limit),
          },
        }),
        GA4_TIMEOUT_MS,
        "Google Analytics did not respond in time.",
      );

      return (data.rows ?? []).map((r) => ({
        channel: r.dimensionValues?.[0]?.value ?? "(not set)",
        source: r.dimensionValues?.[1]?.value ?? "(direct)",
        landingPage: r.dimensionValues?.[2]?.value ?? "(not set)",
        users: Number(r.metricValues?.[0]?.value ?? 0) || 0,
        newUsers: Number(r.metricValues?.[1]?.value ?? 0) || 0,
        sessions: Number(r.metricValues?.[2]?.value ?? 0) || 0,
      }));
    },
  );
}
