import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { brandMatcher } from "./brand";
import {
  type DateWindow,
  dataCutoff,
  formatWindow,
  previousWindow,
  yearAgoWindow,
} from "./dates";

/**
 * Assembles the facts a report is written from.
 *
 * The division of labour is deliberate: arithmetic happens here, diagnosis
 * happens in the model. Anything that can be computed exactly — totals, splits,
 * deltas, which pages moved — is computed, so the model is never inventing a
 * number. What it adds is the part code can't do: deciding what the movement
 * means and what to do about it.
 */

export type Totals = {
  clicks: number;
  impressions: number;
  ctr: number;
  /** Impression-weighted, never a mean of daily means. */
  position: number | null;
};

const EMPTY: Totals = { clicks: 0, impressions: 0, ctr: 0, position: null };

function totalsFrom(rows: { clicks: number; impressions: number; position: number }[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weighted += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : null,
  };
}

export type SegmentTotals = {
  all: Totals;
  branded: Totals;
  nonBranded: Totals;
};

export type PageMovement = {
  url: string;
  path: string;
  title: string;
  clicks: number;
  previousClicks: number;
  change: number;
  impressions: number;
  position: number | null;
};

export type QueryMovement = {
  query: string;
  branded: boolean;
  clicks: number;
  previousClicks: number;
  change: number;
  impressions: number;
  previousImpressions: number;
  position: number | null;
  previousPosition: number | null;
};

export type AiOverviewCandidate = QueryMovement & {
  clicksChangePct: number;
  impressionsChangePct: number;
  positionChange: number;
};

export type ReportInput = {
  client: { name: string; domain: string };
  cadence: "weekly" | "monthly";
  period: DateWindow & { label: string };
  comparison: { previous: DateWindow; yearAgo: DateWindow | null };

  current: SegmentTotals;
  previous: SegmentTotals;
  yearAgo: SegmentTotals | null;

  brandTermsConfigured: boolean;

  topPages: PageMovement[];
  risingPages: PageMovement[];
  fallingPages: PageMovement[];
  publishedInPeriod: { title: string; url: string; publishedAt: string }[];

  topQueries: QueryMovement[];
  risingQueries: QueryMovement[];
  fallingQueries: QueryMovement[];

  /**
   * Queries showing the AI Overview signature — impressions holding, clicks
   * down, position broadly unchanged. Offered as *evidence*, never as a
   * conclusion; the skill is explicit that inventing a cause is how a client
   * spends a quarter fixing the wrong thing.
   */
  aiOverviewCandidates: AiOverviewCandidate[];

  dataCutoff: string;
  /** Windows with no data at all, so the report can say so rather than imply zero. */
  missingWindows: string[];
};

/** How many rows of each list to hand the model. Enough to see a pattern, not a dump. */
const LIST_LIMIT = 10;

export async function buildReportInput(opts: {
  clientId: string;
  cadence: "weekly" | "monthly";
  window: DateWindow;
}): Promise<ReportInput> {
  const db = await getDb();
  const { clientId, cadence, window } = opts;

  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) throw new Error(`No client ${clientId}`);

  const prev = previousWindow(window);
  const yoy = yearAgoWindow(window);
  const matcher = brandMatcher(client.brandTerms);

  const [
    currentQ,
    previousQ,
    yearAgoQ,
    currentPages,
    previousPages,
    published,
  ] = await Promise.all([
    queryRows(clientId, window),
    queryRows(clientId, prev),
    queryRows(clientId, yoy),
    pageRows(clientId, window),
    pageRows(clientId, prev),
    db
      .select({
        title: schema.pages.title,
        url: schema.pages.url,
        publishedAt: schema.pages.publishedAt,
      })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.clientId, clientId),
          gte(schema.pages.publishedAt, window.start),
          lte(schema.pages.publishedAt, window.end),
        ),
      ),
  ]);

  const missingWindows: string[] = [];
  if (currentQ.length === 0) missingWindows.push(`current (${formatWindow(window)})`);
  if (previousQ.length === 0) missingWindows.push(`previous (${formatWindow(prev)})`);

  /**
   * Year-on-year is only offered when the window is genuinely covered.
   *
   * A site that didn't exist a year ago still returns a handful of rows from
   * whichever page happened to be live, which sums to near-zero and renders as
   * a catastrophic year-on-year decline. Reporting that would be a confident
   * wrong number in front of a client — exactly what the standard warns
   * against. Below the coverage bar we say the comparison isn't available.
   */
  const [yoyCoverage, currentCoverage] = await Promise.all([
    windowCoverage(clientId, yoy),
    windowCoverage(clientId, window),
  ]);
  const currentImpressions = currentQ.reduce((n, r) => n + r.impressions, 0);
  const yoyImpressions = yearAgoQ.reduce((n, r) => n + r.impressions, 0);

  const coveredEnough = currentCoverage > 0 && yoyCoverage / currentCoverage >= 0.8;
  // Volume as well as coverage: a site three weeks old a year ago returns a
  // full set of dates carrying almost no impressions, which passes a
  // day-count check and still produces a meaningless -99%.
  const measuredEnough =
    currentImpressions > 0 && yoyImpressions / currentImpressions >= 0.2;
  const hasYoy = yearAgoQ.length > 0 && coveredEnough && measuredEnough;

  if (!hasYoy) {
    let why = "";
    if (yearAgoQ.length === 0) why = " — no data";
    else if (!coveredEnough)
      why = ` — only ${yoyCoverage} of ${currentCoverage} days have data`;
    else why = " — the site had too little search visibility then to compare against";
    missingWindows.push(`year-ago (${formatWindow(yoy)})${why}`);
  }

  const pageMap = new Map(previousPages.map((p) => [p.url, p]));
  const pages: PageMovement[] = currentPages.map((p) => {
    const before = pageMap.get(p.url);
    const previousClicks = before?.clicks ?? 0;
    return {
      url: p.url,
      path: safePath(p.url),
      title: p.title,
      clicks: p.clicks,
      previousClicks,
      change: p.clicks - previousClicks,
      impressions: p.impressions,
      position: p.impressions > 0 ? p.position : null,
    };
  });

  const prevQueryMap = new Map(previousQ.map((q) => [q.query, q]));
  const queries: QueryMovement[] = currentQ.map((q) => {
    const before = prevQueryMap.get(q.query);
    return {
      query: q.query,
      branded: matcher.isBranded(q.query),
      clicks: q.clicks,
      previousClicks: before?.clicks ?? 0,
      change: q.clicks - (before?.clicks ?? 0),
      impressions: q.impressions,
      previousImpressions: before?.impressions ?? 0,
      position: q.impressions > 0 ? q.position : null,
      previousPosition: before && before.impressions > 0 ? before.position : null,
    };
  });

  return {
    client: { name: client.name, domain: client.domain },
    cadence,
    period: { ...window, label: formatWindow(window) },
    comparison: { previous: prev, yearAgo: hasYoy ? yoy : null },

    current: segment(currentQ, matcher),
    previous: segment(previousQ, matcher),
    yearAgo: hasYoy ? segment(yearAgoQ, matcher) : null,

    brandTermsConfigured: matcher.configured,

    topPages: [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, LIST_LIMIT),
    risingPages: [...pages]
      .filter((p) => p.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, LIST_LIMIT),
    fallingPages: [...pages]
      .filter((p) => p.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, LIST_LIMIT),
    publishedInPeriod: published.map((p) => ({
      title: p.title,
      url: p.url,
      publishedAt: p.publishedAt ?? "",
    })),

    topQueries: [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, LIST_LIMIT),
    risingQueries: [...queries]
      .filter((q) => q.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, LIST_LIMIT),
    fallingQueries: [...queries]
      .filter((q) => q.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, LIST_LIMIT),

    aiOverviewCandidates: findAiOverviewCandidates(queries),

    dataCutoff: dataCutoff(),
    missingWindows,
  };
}

/**
 * The AI Overview signature, per the `client-report` skill: "impressions steady,
 * clicks down, CTR down, position unchanged".
 *
 * Thresholds are deliberately strict. A loose detector that flags every query
 * that lost clicks would train the team to ignore it, which is worse than not
 * having it — so it requires meaningful volume, a real click drop, impressions
 * genuinely holding, and a position that barely moved.
 */
function findAiOverviewCandidates(queries: QueryMovement[]): AiOverviewCandidate[] {
  const out: AiOverviewCandidate[] = [];

  for (const q of queries) {
    // Needs a prior period with enough volume for the ratios to mean anything.
    if (q.previousImpressions < 200 || q.previousClicks < 10) continue;

    const clicksChangePct = (q.clicks - q.previousClicks) / q.previousClicks;
    const impressionsChangePct =
      (q.impressions - q.previousImpressions) / q.previousImpressions;
    const positionChange =
      q.position !== null && q.previousPosition !== null
        ? q.position - q.previousPosition
        : 0;

    const clicksDown = clicksChangePct <= -0.2;
    const impressionsHeld = impressionsChangePct >= -0.05;
    const positionStable = Math.abs(positionChange) <= 1;

    if (clicksDown && impressionsHeld && positionStable) {
      out.push({ ...q, clicksChangePct, impressionsChangePct, positionChange });
    }
  }

  return out.sort((a, b) => a.clicksChangePct - b.clicksChangePct).slice(0, LIST_LIMIT);
}

function segment(
  rows: { query: string; clicks: number; impressions: number; position: number }[],
  matcher: ReturnType<typeof brandMatcher>,
): SegmentTotals {
  if (rows.length === 0) return { all: EMPTY, branded: EMPTY, nonBranded: EMPTY };
  const branded = rows.filter((r) => matcher.isBranded(r.query));
  const nonBranded = rows.filter((r) => !matcher.isBranded(r.query));
  return {
    all: totalsFrom(rows),
    branded: totalsFrom(branded),
    nonBranded: totalsFrom(nonBranded),
  };
}

/** Distinct days in the window that actually have query data. */
async function windowCoverage(clientId: string, w: DateWindow): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({
      days: sql<number>`count(distinct ${schema.queryMetrics.date})::int`,
    })
    .from(schema.queryMetrics)
    .where(
      and(
        eq(schema.queryMetrics.clientId, clientId),
        gte(schema.queryMetrics.date, w.start),
        lte(schema.queryMetrics.date, w.end),
      ),
    );
  return Number(row?.days ?? 0);
}

async function queryRows(clientId: string, w: DateWindow) {
  const db = await getDb();
  const rows = await db
    .select({
      query: schema.queryMetrics.query,
      clicks: sql<number>`coalesce(sum(${schema.queryMetrics.clicks}), 0)::int`,
      impressions: sql<number>`coalesce(sum(${schema.queryMetrics.impressions}), 0)::int`,
      position: sql<number>`case when sum(${schema.queryMetrics.impressions}) > 0
        then sum(${schema.queryMetrics.position} * ${schema.queryMetrics.impressions})
             / sum(${schema.queryMetrics.impressions})
        else 0 end`,
    })
    .from(schema.queryMetrics)
    .where(
      and(
        eq(schema.queryMetrics.clientId, clientId),
        gte(schema.queryMetrics.date, w.start),
        lte(schema.queryMetrics.date, w.end),
      ),
    )
    .groupBy(schema.queryMetrics.query);

  return rows.map((r) => ({
    query: r.query,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    position: Number(r.position),
  }));
}

async function pageRows(clientId: string, w: DateWindow) {
  const db = await getDb();
  const pageIds = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId));
  if (pageIds.length === 0) return [];

  const rows = await db
    .select({
      url: schema.pages.url,
      title: schema.pages.title,
      clicks: sql<number>`coalesce(sum(${schema.pageMetrics.clicks}), 0)::int`,
      impressions: sql<number>`coalesce(sum(${schema.pageMetrics.impressions}), 0)::int`,
      position: sql<number>`case when sum(${schema.pageMetrics.impressions}) > 0
        then sum(${schema.pageMetrics.position} * ${schema.pageMetrics.impressions})
             / sum(${schema.pageMetrics.impressions})
        else 0 end`,
    })
    .from(schema.pageMetrics)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.pageMetrics.pageId))
    .where(
      and(
        inArray(
          schema.pageMetrics.pageId,
          pageIds.map((p) => p.id),
        ),
        gte(schema.pageMetrics.date, w.start),
        lte(schema.pageMetrics.date, w.end),
      ),
    )
    .groupBy(schema.pages.url, schema.pages.title);

  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    position: Number(r.position),
  }));
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
