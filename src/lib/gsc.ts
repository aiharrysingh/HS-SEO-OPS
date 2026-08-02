import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, dataCutoff } from "./dates";
import { GSC_SCOPE, resolveGoogleAuth, withTimeout } from "./googleAuth";

/**
 * Google Search Console ingest.
 *
 * Free tier, and comfortably inside it at this volume: 25k rows per request and
 * 50k page-keyword pairs per property per day (plan §6). We request the `page`
 * and `date` dimensions only — not `query` — which keeps each client to a few
 * hundred rows a day.
 *
 * Two ways to authenticate a pull, tried in this order per client:
 *  1. `clients.gscAuthUserId` — a team member's own Google OAuth grant (from
 *     signing in and linking a property on /account). No extra setup: if they
 *     can see the property on /account, this can sync it.
 *  2. The shared service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` /
 *     `GOOGLE_PRIVATE_KEY`) — requires manually adding that service account as
 *     a user on the property in Search Console, but doesn't depend on any one
 *     person's login surviving.
 */

/**
 * GSC revises recent days after first publishing them. Re-pulling a short tail
 * on every sync keeps the stored numbers matching what the console shows,
 * which matters when a client checks our report against their own login.
 */
const RESETTLE_DAYS = 5;

/**
 * How far back the very first sync for a client reaches. 480 days is GSC's
 * full 16-month retention.
 *
 * This was briefly cut to 90 because a first sync looked like a hang: there
 * was no progress logging, no request timeout, and no visible elapsed time, so
 * a large-but-working pull was indistinguishable from a stuck one. Those were
 * the actual defects, and they are fixed — `fetchRows` logs every page of
 * results, requests are bounded by `GSC_REQUEST_TIMEOUT_MS`, and the sync
 * button shows elapsed time and survives a refresh.
 *
 * 90 days was too short for two things that matter: the `client-report`
 * standard's year-on-year comparison, and the milestone columns, which measure
 * a page's first 7/30/90/180 days and therefore need metrics covering the
 * period *before* the page was imported. At 90 days almost every page was
 * published before the data began, so the milestones stayed empty even once
 * publish dates were known.
 *
 * The cost is an honest one: a first sync is now minutes rather than seconds,
 * and query rows land in the low millions per client per year (already
 * anticipated in `query_metrics`'s schema comment). Every later sync resumes
 * from the newest stored date and stays quick.
 */
const INITIAL_BACKFILL_DAYS = 480;

export type SyncResult = {
  clientId: string;
  property: string;
  start: string;
  end: string;
  rowsFetched: number;
  rowsStored: number;
  /** URLs GSC reported that aren't in the `pages` table — worth reviewing. */
  unmatchedUrls: string[];
  /** Rows written to `query_metrics` for the branded split and opportunity terms. */
  queryRowsStored: number;
  /** Rows written to `country_metrics` for the country filter. */
  countryRowsStored: number;
};

export class GscConfigError extends Error {}

/**
 * A `syncStartedAt` older than this is treated as abandoned (crashed process,
 * killed dev server, redeploy mid-sync) rather than a real in-progress sync —
 * otherwise a crash would wedge the button and the duplicate-sync guard
 * forever. Comfortably longer than any real sync, including a first-ever
 * 480-day backfill across both dimension pulls; short enough that a
 * genuinely stuck row doesn't block a client for hours.
 */
export const SYNC_STALE_AFTER_MINUTES = 15;

export function isSyncActive(syncStartedAt: Date | null, now = new Date()): boolean {
  if (!syncStartedAt) return false;
  return now.getTime() - syncStartedAt.getTime() < SYNC_STALE_AFTER_MINUTES * 60_000;
}

export class SyncInProgressError extends Error {
  startedAt: Date;
  constructor(startedAt: Date) {
    super(
      `Already syncing — started ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s ago.`,
    );
    this.startedAt = startedAt;
  }
}

/** Whether the shared service-account fallback is set up — not the whole story any more, see `resolveAuth`. */
export function isGscConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY,
  );
}

/**
 * Picks the credential to sync one client with — that client's linked Google
 * account if it has one and still holds a refresh token, else the shared
 * service account. Throws `GscConfigError` (with next steps for either path)
 * only when neither is available.
 */
function resolveAuth(client: { gscAuthUserId: string | null }) {
  return resolveGoogleAuth(
    { authUserId: client.gscAuthUserId, scope: GSC_SCOPE },
    () => {
      throw new GscConfigError(
        "No way to reach Search Console for this client. Either sign in on " +
          "/account with a Google account that has access to the property and " +
          "link it there, or set GOOGLE_SERVICE_ACCOUNT_EMAIL and " +
          "GOOGLE_PRIVATE_KEY and grant that service account read access to it.",
      );
    },
  );
}

type GscRow = {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

/** Per-request ceiling; see `withTimeout` in googleAuth.ts for why it exists. */
const GSC_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Pulls rows for one property along the given dimensions, paging until GSC
 * stops returning data. Row limit is the API maximum.
 *
 * GSC allows at most four combinable dimensions, and combining `page` with
 * `query` multiplies row count by page count — straight into the 50k
 * page-keyword-pairs/property/day ceiling. So the two syncs below request
 * `page × date` and `date × query` separately and join client-side, which is
 * what the API docs recommend anyway.
 */
async function fetchRows(
  auth: Awaited<ReturnType<typeof resolveAuth>>,
  property: string,
  dimensions: string[],
  start: string,
  end: string,
): Promise<GscRow[]> {
  const { google } = await import("googleapis");
  const api = google.searchconsole({ version: "v1", auth });
  const out: GscRow[] = [];
  const ROW_LIMIT = 25_000;
  const label = `[gsc] ${property} ${dimensions.join("×")} ${start}..${end}`;
  const startedAt = Date.now();

  for (let startRow = 0; ; startRow += ROW_LIMIT) {
    // Logged per page: without this, a slow multi-page pull is
    // indistinguishable from a hang, which is exactly how a very large first
    // backfill got misdiagnosed as a network failure.
    console.log(`${label} requesting rows from ${startRow}…`);

    const res = await withTimeout(
      api.searchanalytics.query({
        siteUrl: property,
        requestBody: {
          startDate: start,
          endDate: end,
          dimensions,
          rowLimit: ROW_LIMIT,
          startRow,
          dataState: "final",
        },
      }),
      GSC_REQUEST_TIMEOUT_MS,
      `Search Console didn't respond within ${GSC_REQUEST_TIMEOUT_MS / 1000}s. This looks like a network issue reaching Google from this environment, not a Search Console problem — try again.`,
    );

    const rows = res.data.rows ?? [];
    out.push(...rows);
    console.log(
      `${label} got ${rows.length} rows (${out.length} total, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
    );
    if (rows.length < ROW_LIMIT) break;
  }

  return out;
}

/**
 * Trailing slashes, fragments and tracking params all produce distinct GSC
 * URLs for the same page. Matching on a normalised form stops a page silently
 * reporting zero because the stored URL ends in "/" and GSC's doesn't.
 */
export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname}${path}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

export type ImportPagesResult = {
  clientId: string;
  /** Distinct URLs Search Console reported in the window. */
  found: number;
  /** New `pages` rows created (URLs already tracked are left alone). */
  created: number;
  skipped: number;
};

/**
 * Turns the URLs Search Console already knows about into tracked `pages` rows.
 *
 * The sync deliberately never auto-creates pages — publish date and target
 * keyword are curated, not derivable — but that left no way to populate the
 * tracker at all, so every page row GSC returned was discarded as "unmatched".
 * This is the missing halfway step: it creates the rows with a sensible title
 * and type guess and leaves `publishedAt`/`targetKeyword` blank for a human to
 * fill in, which is what the milestone columns need anyway.
 *
 * Requests the `page` dimension alone (not `page × date`), so this is one small
 * result set of distinct URLs rather than a row per page per day.
 */
export async function importPagesFromGsc(
  clientId: string,
  { days = 90, minImpressions = 1 }: { days?: number; minImpressions?: number } = {},
): Promise<ImportPagesResult> {
  const db = await getDb();

  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) throw new Error(`No client ${clientId}`);
  if (!client.gscProperty) {
    throw new GscConfigError(`${client.name} has no Search Console property set.`);
  }

  const auth = await resolveAuth(client);
  const end = dataCutoff();
  const start = addDays(end, -(days - 1));

  const rows = await fetchRows(auth, client.gscProperty, ["page"], start, end);

  const existing = await db
    .select({ url: schema.pages.url })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId));
  const known = new Set(existing.map((p) => normaliseUrl(p.url)));

  const values: (typeof schema.pages.$inferInsert)[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const url = row.keys?.[0];
    if (!url) continue;
    if ((row.impressions ?? 0) < minImpressions) {
      skipped++;
      continue;
    }
    const key = normaliseUrl(url);
    if (known.has(key) || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    values.push({
      clientId,
      url,
      type: guessPageType(url),
      title: titleFromUrl(url),
      status: "live",
      // Left blank on purpose: the milestone columns measure from a real
      // go-live date, and a guessed one would quietly produce wrong numbers.
      publishedAt: null,
      targetKeyword: null,
    });
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.pages)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing();
  }

  return { clientId, found: rows.length, created: values.length, skipped };
}

/**
 * Blog-ish paths are the common case worth detecting; everything else is a
 * landing page. Matches a keyword *within* a path segment, not just a whole
 * one — real sites use "/tech-insights/…" and "/resource-centre/…" as often as
 * a bare "/blog/", and requiring an exact segment silently mislabels them.
 */
export function guessPageType(url: string): "blog" | "landing" {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  return /\/[^/]*(blog|article|news|insight|resource|tutorial|guide|case-stud)[^/]*\//.test(path)
    ? "blog"
    : "landing";
}

/** Last path segment, de-slugged. Good enough to scan a table by; editable later. */
export function titleFromUrl(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const slug = path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  if (!slug) return "Home";
  return slug
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function syncClient(clientId: string): Promise<SyncResult> {
  const db = await getDb();

  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) throw new Error(`No client ${clientId}`);
  if (!client.gscProperty) {
    throw new GscConfigError(
      `${client.name} has no Search Console property set.`,
    );
  }

  // Atomic claim, not read-then-check — two concurrent requests (a double
  // click, or a manual sync racing the nightly cron) must not both pass a
  // check based on a value read before either had written anything.
  const staleCutoff = new Date(Date.now() - SYNC_STALE_AFTER_MINUTES * 60_000);
  const [claimed] = await db
    .update(schema.clients)
    .set({ syncStartedAt: new Date() })
    .where(
      and(
        eq(schema.clients.id, clientId),
        or(
          isNull(schema.clients.syncStartedAt),
          lt(schema.clients.syncStartedAt, staleCutoff),
        ),
      ),
    )
    .returning({ syncStartedAt: schema.clients.syncStartedAt });

  if (!claimed) throw new SyncInProgressError(client.syncStartedAt!);

  const auth = await resolveAuth(client);

  const trackedPages = await db
    .select({ id: schema.pages.id, url: schema.pages.url })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId));

  const byUrl = new Map(trackedPages.map((p) => [normaliseUrl(p.url), p.id]));

  const end = dataCutoff();
  const hasCompletedSync = client.lastSyncedAt !== null;
  const start = await syncStart(
    clientId,
    trackedPages.map((p) => p.id),
    end,
    hasCompletedSync,
  );

  try {
    const rows = await fetchRows(
      auth,
      client.gscProperty,
      ["page", "date"],
      start,
      end,
    );

    const unmatched = new Set<string>();
    /**
     * Merged by (pageId, date) rather than pushed straight to a list.
     *
     * `normaliseUrl` maps URL variants — trailing slash, `www.`, http vs https,
     * query strings — onto one tracked page, by design. Search Console still
     * reports those variants as separate rows, so several can land on the same
     * page on the same day. Inserting them unmerged puts the same conflict
     * target twice in one statement, which Postgres rejects outright
     * ("ON CONFLICT DO UPDATE command cannot affect row a second time") and
     * which fails the whole sync. Summing is also just the right answer: those
     * really are the same page's clicks.
     */
    const merged = new Map<string, typeof schema.pageMetrics.$inferInsert>();

    for (const row of rows) {
      const [url, date] = row.keys ?? [];
      if (!url || !date) continue;

      const pageId = byUrl.get(normaliseUrl(url));
      if (!pageId) {
        unmatched.add(url);
        continue;
      }

      const clicks = Math.round(row.clicks ?? 0);
      const impressions = Math.round(row.impressions ?? 0);
      const position = row.position ?? 0;

      const key = `${pageId}|${date}`;
      const prior = merged.get(key);
      if (!prior) {
        merged.set(key, { pageId, date, clicks, impressions, ctr: row.ctr ?? 0, position });
        continue;
      }

      const totalImpressions = prior.impressions! + impressions;
      // Position is an average over impressions, so combining two variants
      // means weighting by impressions — a plain mean would over-count a
      // variant with almost no traffic.
      const weightedPosition =
        totalImpressions > 0
          ? (prior.position! * prior.impressions! + position * impressions) / totalImpressions
          : 0;
      const totalClicks = prior.clicks! + clicks;

      merged.set(key, {
        pageId,
        date,
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
        position: weightedPosition,
      });
    }

    const values = [...merged.values()];

    for (let i = 0; i < values.length; i += 500) {
      await db
        .insert(schema.pageMetrics)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [schema.pageMetrics.pageId, schema.pageMetrics.date],
          set: {
            clicks: sql`excluded.clicks`,
            impressions: sql`excluded.impressions`,
            ctr: sql`excluded.ctr`,
            position: sql`excluded.position`,
          },
        });
    }

    const queryRowsStored = await syncQueries(
      auth,
      clientId,
      client.gscProperty,
      end,
      hasCompletedSync,
    );

    const countryRowsStored = await syncCountries(
      auth,
      clientId,
      client.gscProperty,
      end,
      hasCompletedSync,
    );

    await db
      .update(schema.clients)
      .set({ lastSyncedAt: new Date(), lastSyncError: null, syncStartedAt: null })
      .where(eq(schema.clients.id, clientId));

    return {
      clientId,
      property: client.gscProperty,
      start,
      end,
      rowsFetched: rows.length,
      rowsStored: values.length,
      unmatchedUrls: [...unmatched].slice(0, 50),
      queryRowsStored,
      countryRowsStored,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure so the UI can say so rather than quietly serving
    // yesterday's numbers as if they were fresh.
    await db
      .update(schema.clients)
      .set({ lastSyncError: message.slice(0, 500), syncStartedAt: null })
      .where(eq(schema.clients.id, clientId));
    throw err;
  }
}

/**
 * Pulls site-level query × date rows into `query_metrics`.
 *
 * Runs against its own resume point rather than the page sync's: a client added
 * before query syncing existed has page history but no query history, and
 * sharing a start date would leave that gap permanently unfilled.
 */
async function syncQueries(
  auth: Awaited<ReturnType<typeof resolveAuth>>,
  clientId: string,
  property: string,
  end: string,
  hasCompletedSync: boolean,
): Promise<number> {
  const db = await getDb();

  const [latest] = hasCompletedSync
    ? await db
        .select({ date: schema.queryMetrics.date })
        .from(schema.queryMetrics)
        .where(eq(schema.queryMetrics.clientId, clientId))
        .orderBy(desc(schema.queryMetrics.date))
        .limit(1)
    : // Same reasoning as syncStart: rows left by a failed run carry a recent
      // max(date) that would permanently mask the days it never reached.
      [undefined];

  const floor = addDays(end, -(INITIAL_BACKFILL_DAYS - 1));
  let start = floor;
  if (latest) {
    const resume = addDays(latest.date, -RESETTLE_DAYS);
    start = resume < floor ? floor : resume;
  }
  // Deliberately *not* clamped to the page sync's start. This pull keeps its
  // own resume point precisely so a dimension added after a client was already
  // syncing can still backfill: clamping to `pageStart` would pin it to
  // whatever narrow window the page sync happened to need, and the gap would
  // never be filled on any later run either.

  const rows = await fetchRows(auth, property, ["date", "query"], start, end);

  const values: (typeof schema.queryMetrics.$inferInsert)[] = [];
  for (const row of rows) {
    const [date, query] = row.keys ?? [];
    if (!date || !query) continue;
    values.push({
      clientId,
      date,
      query,
      clicks: Math.round(row.clicks ?? 0),
      impressions: Math.round(row.impressions ?? 0),
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    });
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.queryMetrics)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [
          schema.queryMetrics.clientId,
          schema.queryMetrics.date,
          schema.queryMetrics.query,
        ],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          ctr: sql`excluded.ctr`,
          position: sql`excluded.position`,
        },
      });
  }

  return values.length;
}

/**
 * Pulls site-level country × date rows into `country_metrics`.
 *
 * Cheap compared to the other two pulls — one row per country per day rather
 * than per page or per query — so this adds a second or two to a sync, not a
 * minute. Same resume-point reasoning as `syncQueries`, including the
 * `hasCompletedSync` guard that stops a half-written table masking the days a
 * failed run never reached.
 */
async function syncCountries(
  auth: Awaited<ReturnType<typeof resolveAuth>>,
  clientId: string,
  property: string,
  end: string,
  hasCompletedSync: boolean,
): Promise<number> {
  const db = await getDb();

  const [latest] = hasCompletedSync
    ? await db
        .select({ date: schema.countryMetrics.date })
        .from(schema.countryMetrics)
        .where(eq(schema.countryMetrics.clientId, clientId))
        .orderBy(desc(schema.countryMetrics.date))
        .limit(1)
    : [undefined];

  const floor = addDays(end, -(INITIAL_BACKFILL_DAYS - 1));
  let start = floor;
  if (latest) {
    const resume = addDays(latest.date, -RESETTLE_DAYS);
    start = resume < floor ? floor : resume;
  }
  // Same reasoning as syncQueries: keep this pull's own resume point rather
  // than clamping to the page sync's window, so a first-time country backfill
  // isn't pinned to the last few days.

  const rows = await fetchRows(auth, property, ["date", "country"], start, end);

  const values: (typeof schema.countryMetrics.$inferInsert)[] = [];
  for (const row of rows) {
    const [date, country] = row.keys ?? [];
    if (!date || !country) continue;
    values.push({
      clientId,
      date,
      country: country.toLowerCase(),
      clicks: Math.round(row.clicks ?? 0),
      impressions: Math.round(row.impressions ?? 0),
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    });
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.countryMetrics)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [
          schema.countryMetrics.clientId,
          schema.countryMetrics.date,
          schema.countryMetrics.country,
        ],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          ctr: sql`excluded.ctr`,
          position: sql`excluded.position`,
        },
      });
  }

  return values.length;
}

/**
 * Resume from just before the newest stored metric, or backfill on first run.
 *
 * `hasCompletedSync` is what stops a half-written table from being mistaken
 * for a complete one. A sync that dies partway (as one did on the duplicate
 * conflict-target bug) still leaves rows behind, and those rows carry a recent
 * `max(date)`. Resuming from that high-water mark skips every day the failed
 * run never reached — permanently, because each later run resumes from the
 * same mark. The symptom is a table that looks 90 days deep but has real
 * coverage only in the last few.
 *
 * So: only trust the stored maximum once a sync has actually finished for this
 * client. Until then, re-request the full backfill. The writes are idempotent
 * upserts, so re-pulling costs time, never correctness.
 */
async function syncStart(
  clientId: string,
  pageIds: string[],
  end: string,
  hasCompletedSync: boolean,
): Promise<string> {
  const floor = addDays(end, -(INITIAL_BACKFILL_DAYS - 1));
  if (pageIds.length === 0 || !hasCompletedSync) return floor;

  const db = await getDb();
  const [latest] = await db
    .select({ date: schema.pageMetrics.date })
    .from(schema.pageMetrics)
    .where(inArray(schema.pageMetrics.pageId, pageIds))
    .orderBy(desc(schema.pageMetrics.date))
    .limit(1);

  if (!latest) return floor;

  const resume = addDays(latest.date, -RESETTLE_DAYS);
  return resume < floor ? floor : resume;
}

export async function syncAllClients(): Promise<{
  results: SyncResult[];
  failures: { clientId: string; name: string; error: string }[];
}> {
  const db = await getDb();
  const clients = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(sql`${schema.clients.gscProperty} is not null`));

  const results: SyncResult[] = [];
  const failures: { clientId: string; name: string; error: string }[] = [];

  // Sequential on purpose — GSC quota is per property per day, but hammering
  // the API in parallel for a handful of clients buys nothing.
  for (const c of clients) {
    try {
      results.push(await syncClient(c.id));
    } catch (err) {
      failures.push({
        clientId: c.id,
        name: c.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results, failures };
}
