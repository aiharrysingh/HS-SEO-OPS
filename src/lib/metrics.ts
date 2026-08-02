import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PageStatus, PageType } from "@/db/schema";
import {
  DEFAULT_RANGE_DAYS,
  MILESTONES,
  type DateWindow,
  type MilestoneKey,
  dataCutoff,
  previousWindow,
  trailingWindow,
} from "./dates";

export type Totals = {
  clicks: number;
  impressions: number;
  /** Click-weighted average position, not a mean of daily means. */
  position: number | null;
  ctr: number;
};

const EMPTY: Totals = { clicks: 0, impressions: 0, position: null, ctr: 0 };

/**
 * Aggregate expression shared by every rollup below.
 *
 * Position is weighted by impressions. Averaging the daily `position` column
 * directly would let a day with three impressions count as much as a day with
 * three thousand, which is the most common way these dashboards end up lying.
 */
const AGG = {
  clicks: sql<number>`coalesce(sum(${schema.pageMetrics.clicks}), 0)::int`,
  impressions: sql<number>`coalesce(sum(${schema.pageMetrics.impressions}), 0)::int`,
  position: sql<
    number | null
  >`case when sum(${schema.pageMetrics.impressions}) > 0
       then sum(${schema.pageMetrics.position} * ${schema.pageMetrics.impressions})
            / sum(${schema.pageMetrics.impressions})
       else null end`,
};

function withCtr(row: {
  clicks: number;
  impressions: number;
  position: number | null;
}): Totals {
  return {
    clicks: Number(row.clicks) || 0,
    impressions: Number(row.impressions) || 0,
    position: row.position === null ? null : Number(row.position),
    ctr: row.impressions > 0 ? Number(row.clicks) / Number(row.impressions) : 0,
  };
}

export type PageRow = {
  id: string;
  url: string;
  path: string;
  title: string;
  type: PageType;
  status: PageStatus;
  publishedAt: string | null;
  targetKeyword: string | null;
  ageDays: number | null;
  current: Totals;
  previous: Totals;
  /** null where the milestone window has not fully elapsed yet. */
  milestones: Record<MilestoneKey, Totals | null>;
  /** Daily clicks across the current window, oldest first — for the sparkline. */
  spark: number[];
};

export type ClientPerformance = {
  window: DateWindow;
  previous: DateWindow;
  cutoff: string;
  /**
   * Request time, read here rather than in a component. "How long since the
   * last sync" is data the request carries, not something a render goes and
   * finds out for itself.
   */
  now: number;
  totals: Totals;
  previousTotals: Totals;
  daily: { date: string; clicks: number; impressions: number }[];
  pages: PageRow[];
};

/**
 * Everything the Content Performance Tracker needs for one client, in five
 * queries regardless of page count.
 *
 * Volume here is low by design (plan §3: low thousands of URLs in total), so
 * the milestone rollups run as four small grouped queries rather than anything
 * cleverer. Revisit only if page counts grow by an order of magnitude.
 */
export async function getClientPerformance(
  clientId: string,
  window: DateWindow = trailingWindow(DEFAULT_RANGE_DAYS),
): Promise<ClientPerformance> {
  const db = await getDb();
  const cutoff = dataCutoff();
  const now = Date.now();
  const prev = previousWindow(window);

  const pages = await db
    .select()
    .from(schema.pages)
    // Drafts are the content calendar, not published pages. They have no
    // metrics by definition, so including them would pad the tracker with
    // zero rows and drag every average down.
    .where(
      and(
        eq(schema.pages.clientId, clientId),
        ne(schema.pages.status, "draft"),
      ),
    )
    .orderBy(desc(schema.pages.publishedAt));

  if (pages.length === 0) {
    return {
      window,
      previous: prev,
      cutoff,
      now,
      totals: EMPTY,
      previousTotals: EMPTY,
      daily: [],
      pages: [],
    };
  }

  const pageIds = pages.map((p) => p.id);
  const inClient = inArray(schema.pageMetrics.pageId, pageIds);

  const inWindow = (w: DateWindow) =>
    and(
      inClient,
      gte(schema.pageMetrics.date, w.start),
      lte(schema.pageMetrics.date, w.end),
    );

  const byPage = (w: DateWindow) =>
    db
      .select({ pageId: schema.pageMetrics.pageId, ...AGG })
      .from(schema.pageMetrics)
      .where(inWindow(w))
      .groupBy(schema.pageMetrics.pageId);

  const [currentRows, previousRows, dailyRows, sparkRows, ...milestoneRows] =
    await Promise.all([
      byPage(window),
      byPage(prev),
      db
        .select({
          date: schema.pageMetrics.date,
          clicks: AGG.clicks,
          impressions: AGG.impressions,
        })
        .from(schema.pageMetrics)
        .where(inWindow(window))
        .groupBy(schema.pageMetrics.date)
        .orderBy(asc(schema.pageMetrics.date)),
      db
        .select({
          pageId: schema.pageMetrics.pageId,
          date: schema.pageMetrics.date,
          clicks: schema.pageMetrics.clicks,
        })
        .from(schema.pageMetrics)
        .where(inWindow(window))
        .orderBy(asc(schema.pageMetrics.date)),
      ...MILESTONES.map((m) => milestoneTotals(pageIds, m.days, cutoff)),
    ]);

  const current = index(currentRows);
  const previousByPage = index(previousRows);
  const milestoneIndex = MILESTONES.map((_, i) => index(milestoneRows[i]));

  const sparkByPage = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    let m = sparkByPage.get(r.pageId);
    if (!m) sparkByPage.set(r.pageId, (m = new Map()));
    m.set(r.date, (m.get(r.date) ?? 0) + r.clicks);
  }
  const windowDates = dailySpan(window);

  const rows: PageRow[] = pages.map((p) => {
    const spark = sparkByPage.get(p.id) ?? new Map();
    return {
      id: p.id,
      url: p.url,
      path: safePath(p.url),
      title: p.title,
      type: p.type,
      status: p.status,
      publishedAt: p.publishedAt,
      targetKeyword: p.targetKeyword,
      ageDays: p.publishedAt ? daysSince(p.publishedAt, cutoff) : null,
      current: current.get(p.id) ?? EMPTY,
      previous: previousByPage.get(p.id) ?? EMPTY,
      milestones: Object.fromEntries(
        MILESTONES.map((m, i) => [m.key, milestoneIndex[i].get(p.id) ?? null]),
      ) as Record<MilestoneKey, Totals | null>,
      spark: windowDates.map((d) => spark.get(d) ?? 0),
    };
  });

  return {
    window,
    previous: prev,
    cutoff,
    now,
    totals: sumTotals(rows.map((r) => r.current)),
    previousTotals: sumTotals(rows.map((r) => r.previous)),
    daily: dailyRows.map((d) => ({
      date: d.date,
      clicks: Number(d.clicks),
      impressions: Number(d.impressions),
    })),
    pages: rows,
  };
}

/**
 * Totals for each page's first `days` of life, measured from its own publish
 * date — so "Month 1" means the same thing for a page published in March as
 * one published last week.
 *
 * Pages whose window has not fully elapsed are excluded rather than reported
 * partial; a half-finished Month 3 number invites exactly the wrong comparison.
 */
function milestoneTotals(pageIds: string[], days: number, cutoff: string) {
  return getDb().then((db) =>
    db
      .select({ pageId: schema.pageMetrics.pageId, ...AGG })
      .from(schema.pageMetrics)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageMetrics.pageId))
      .where(
        and(
          inArray(schema.pageMetrics.pageId, pageIds),
          isNotNull(schema.pages.publishedAt),
          // Exclude pages whose window has not fully elapsed.
          // The ::int casts are required: `date + $1` alone is ambiguous.
          sql`${schema.pages.publishedAt} + ${days - 1}::int <= ${cutoff}::date`,
          gte(schema.pageMetrics.date, schema.pages.publishedAt),
          sql`${schema.pageMetrics.date} <= ${schema.pages.publishedAt} + ${days - 1}::int`,
        ),
      )
      .groupBy(schema.pageMetrics.pageId),
  );
}

export type ClientSummary = {
  id: string;
  name: string;
  domain: string;
  gscProperty: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  /** Hours since the last successful sync; null if it has never run. */
  syncAgeHours: number | null;
  pageCount: number;
  current: Totals;
  previous: Totals;
  daily: number[];
};

/** Portfolio view: one row per client rolled up over `window`, with a trend. */
export async function getClientSummaries(
  window: DateWindow = trailingWindow(DEFAULT_RANGE_DAYS),
): Promise<ClientSummary[]> {
  const db = await getDb();
  const now = Date.now();
  const prev = previousWindow(window);

  const clients = await db
    .select()
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));

  const byClient = (w: DateWindow) =>
    db
      .select({ clientId: schema.pages.clientId, ...AGG })
      .from(schema.pageMetrics)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageMetrics.pageId))
      .where(
        and(
          gte(schema.pageMetrics.date, w.start),
          lte(schema.pageMetrics.date, w.end),
        ),
      )
      .groupBy(schema.pages.clientId);

  const [currentRows, previousRows, countRows, dailyRows] = await Promise.all([
    byClient(window),
    byClient(prev),
    db
      .select({
        clientId: schema.pages.clientId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.pages)
      .groupBy(schema.pages.clientId),
    db
      .select({
        clientId: schema.pages.clientId,
        date: schema.pageMetrics.date,
        clicks: AGG.clicks,
      })
      .from(schema.pageMetrics)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageMetrics.pageId))
      .where(
        and(
          gte(schema.pageMetrics.date, window.start),
          lte(schema.pageMetrics.date, window.end),
        ),
      )
      .groupBy(schema.pages.clientId, schema.pageMetrics.date)
      .orderBy(asc(schema.pageMetrics.date)),
  ]);

  const current = indexBy(currentRows, "clientId");
  const previous = indexBy(previousRows, "clientId");
  const counts = new Map(countRows.map((r) => [r.clientId, Number(r.count)]));
  const dailyByClient = new Map<string, Map<string, number>>();
  for (const r of dailyRows) {
    let m = dailyByClient.get(r.clientId);
    if (!m) dailyByClient.set(r.clientId, (m = new Map()));
    m.set(r.date, Number(r.clicks));
  }
  const span = dailySpan(window);

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    gscProperty: c.gscProperty,
    lastSyncedAt: c.lastSyncedAt,
    lastSyncError: c.lastSyncError,
    syncAgeHours: c.lastSyncedAt
      ? (now - c.lastSyncedAt.getTime()) / 3_600_000
      : null,
    pageCount: counts.get(c.id) ?? 0,
    current: current.get(c.id) ?? EMPTY,
    previous: previous.get(c.id) ?? EMPTY,
    daily: span.map((d) => dailyByClient.get(c.id)?.get(d) ?? 0),
  }));
}

export type PageDetail = {
  page: typeof schema.pages.$inferSelect;
  client: typeof schema.clients.$inferSelect;
  cutoff: string;
  /** The window `current`/`previous` cover, so the screen can label them. */
  window: DateWindow;
  previousWindow: DateWindow;
  lifetime: Totals;
  current: Totals;
  previous: Totals;
  milestones: { key: MilestoneKey; label: string; totals: Totals | null }[];
  daily: {
    date: string;
    clicks: number;
    impressions: number;
    position: number;
  }[];
};

export async function getPageDetail(
  pageId: string,
  window: DateWindow = trailingWindow(DEFAULT_RANGE_DAYS),
): Promise<PageDetail | null> {
  const db = await getDb();
  const cutoff = dataCutoff();

  const [row] = await db
    .select({ page: schema.pages, client: schema.clients })
    .from(schema.pages)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.pages.clientId))
    .where(eq(schema.pages.id, pageId))
    .limit(1);

  if (!row) return null;

  const prev = previousWindow(window);

  const totalsFor = (w?: DateWindow) =>
    db
      .select(AGG)
      .from(schema.pageMetrics)
      .where(
        w
          ? and(
              eq(schema.pageMetrics.pageId, pageId),
              gte(schema.pageMetrics.date, w.start),
              lte(schema.pageMetrics.date, w.end),
            )
          : and(
              eq(schema.pageMetrics.pageId, pageId),
              lte(schema.pageMetrics.date, cutoff),
            ),
      );

  const [lifetime, current, previous, daily] = await Promise.all([
    totalsFor(),
    totalsFor(window),
    totalsFor(prev),
    db
      .select({
        date: schema.pageMetrics.date,
        clicks: schema.pageMetrics.clicks,
        impressions: schema.pageMetrics.impressions,
        position: schema.pageMetrics.position,
      })
      .from(schema.pageMetrics)
      .where(
        and(
          eq(schema.pageMetrics.pageId, pageId),
          lte(schema.pageMetrics.date, cutoff),
        ),
      )
      .orderBy(asc(schema.pageMetrics.date)),
  ]);

  const milestones = MILESTONES.map((m) => {
    const published = row.page.publishedAt;
    if (!published) return { key: m.key, label: m.label, totals: null };
    const end = addDaysIso(published, m.days - 1);
    if (end > cutoff) return { key: m.key, label: m.label, totals: null };
    const slice = daily.filter((d) => d.date >= published && d.date <= end);
    return { key: m.key, label: m.label, totals: aggregate(slice) };
  });

  return {
    page: row.page,
    client: row.client,
    cutoff,
    window,
    previousWindow: prev,
    lifetime: withCtr(lifetime[0] ?? EMPTY),
    current: withCtr(current[0] ?? EMPTY),
    previous: withCtr(previous[0] ?? EMPTY),
    milestones,
    daily,
  };
}

/* ------------------------------ countries -------------------------------- */

/**
 * Aggregate over `country_metrics`. Separate from `AGG` because that one is
 * bound to `page_metrics` columns.
 */
const COUNTRY_AGG = {
  clicks: sql<number>`coalesce(sum(${schema.countryMetrics.clicks}), 0)::int`,
  impressions: sql<number>`coalesce(sum(${schema.countryMetrics.impressions}), 0)::int`,
  position: sql<number | null>`case when sum(${schema.countryMetrics.impressions}) > 0
       then sum(${schema.countryMetrics.position} * ${schema.countryMetrics.impressions})
            / sum(${schema.countryMetrics.impressions})
       else null end`,
};

export type CountryRow = {
  /** ISO-3166-1 alpha-3, lowercase. */
  country: string;
  current: Totals;
  previous: Totals;
};

/**
 * Site-wide totals and daily series for a country selection.
 *
 * **This is a different basis from `getClientPerformance`, deliberately.**
 * That function sums the client's *tracked pages*; this reads GSC's
 * property-wide country totals. The two will not reconcile — a property always
 * has traffic on URLs nobody has added to `pages` — so any screen showing both
 * has to say which it is showing. Silently swapping one for the other when a
 * filter is applied would move the number for reasons the reader can't see.
 *
 * An empty `countries` list means every country, i.e. the property total.
 */
export async function getCountryPerformance(
  clientId: string,
  window: DateWindow,
  countries: string[] = [],
): Promise<{
  totals: Totals;
  previousTotals: Totals;
  daily: { date: string; clicks: number; impressions: number }[];
}> {
  const db = await getDb();
  const prev = previousWindow(window);

  const scope = (w: DateWindow) =>
    and(
      eq(schema.countryMetrics.clientId, clientId),
      gte(schema.countryMetrics.date, w.start),
      lte(schema.countryMetrics.date, w.end),
      countries.length > 0
        ? inArray(schema.countryMetrics.country, countries)
        : undefined,
    );

  const [current, previous, dailyRows] = await Promise.all([
    db.select(COUNTRY_AGG).from(schema.countryMetrics).where(scope(window)),
    db.select(COUNTRY_AGG).from(schema.countryMetrics).where(scope(prev)),
    db
      .select({
        date: schema.countryMetrics.date,
        clicks: sql<number>`coalesce(sum(${schema.countryMetrics.clicks}), 0)::int`,
        impressions: sql<number>`coalesce(sum(${schema.countryMetrics.impressions}), 0)::int`,
      })
      .from(schema.countryMetrics)
      .where(scope(window))
      .groupBy(schema.countryMetrics.date)
      .orderBy(asc(schema.countryMetrics.date)),
  ]);

  // Densify so a day with no rows plots as zero rather than shortening the
  // series and silently shifting the x-axis.
  const byDate = new Map(dailyRows.map((r) => [r.date, r]));
  const daily = dailySpan(window).map((date) => ({
    date,
    clicks: Number(byDate.get(date)?.clicks ?? 0),
    impressions: Number(byDate.get(date)?.impressions ?? 0),
  }));

  return {
    totals: withCtr(current[0] ?? EMPTY),
    previousTotals: withCtr(previous[0] ?? EMPTY),
    daily,
  };
}

/**
 * Every country this client has data for in the window, biggest first.
 *
 * Powers both the country picker (so it offers only countries that actually
 * appear, not a list of 250) and the breakdown table.
 */
export async function getCountryBreakdown(
  clientId: string,
  window: DateWindow,
): Promise<CountryRow[]> {
  const db = await getDb();
  const prev = previousWindow(window);

  const byCountry = (w: DateWindow) =>
    db
      .select({ country: schema.countryMetrics.country, ...COUNTRY_AGG })
      .from(schema.countryMetrics)
      .where(
        and(
          eq(schema.countryMetrics.clientId, clientId),
          gte(schema.countryMetrics.date, w.start),
          lte(schema.countryMetrics.date, w.end),
        ),
      )
      .groupBy(schema.countryMetrics.country);

  const [currentRows, previousRows] = await Promise.all([
    byCountry(window),
    byCountry(prev),
  ]);

  const prevByCountry = indexBy(previousRows, "country");

  return currentRows
    .map((r) => ({
      country: r.country,
      current: withCtr(r),
      previous: prevByCountry.get(r.country) ?? EMPTY,
    }))
    .sort((a, b) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions);
}

/* ------------------------------- helpers -------------------------------- */

function index(rows: { pageId: string; clicks: number; impressions: number; position: number | null }[]) {
  return new Map(rows.map((r) => [r.pageId, withCtr(r)]));
}

function indexBy<K extends string>(
  rows: (Record<K, string> & {
    clicks: number;
    impressions: number;
    position: number | null;
  })[],
  key: K,
) {
  return new Map(rows.map((r) => [r[key], withCtr(r)]));
}

function sumTotals(list: Totals[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const t of list) {
    clicks += t.clicks;
    impressions += t.impressions;
    if (t.position !== null) weighted += t.position * t.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : null,
  };
}

function aggregate(
  rows: { clicks: number; impressions: number; position: number }[],
): Totals {
  return sumTotals(
    rows.map((r) => ({
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
      ctr: 0,
    })),
  );
}

function dailySpan(w: DateWindow): string[] {
  const out: string[] = [];
  for (let d = w.start; d <= w.end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysSince(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
