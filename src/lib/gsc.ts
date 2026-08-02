import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, dataCutoff } from "./dates";
import { clientFromStoredTokens } from "./googleOAuth";

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

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * GSC revises recent days after first publishing them. Re-pulling a short tail
 * on every sync keeps the stored numbers matching what the console shows,
 * which matters when a client checks our report against their own login.
 */
const RESETTLE_DAYS = 5;

/**
 * How far back the very first sync for a client reaches.
 *
 * 16 months is GSC's own retention limit, and reports need it: the
 * `client-report` standard asks for year-on-year "where the data exists", and
 * anything shorter means the first year of reports simply can't answer it.
 * The first sync for a client is correspondingly slow; every later one resumes
 * from the newest stored date.
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
async function resolveAuth(client: { gscAuthUserId: string | null }) {
  if (client.gscAuthUserId) {
    const db = await getDb();
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, client.gscAuthUserId))
      .limit(1);

    if (user?.refreshToken) {
      const userId = user.id;
      const auth = await clientFromStoredTokens({
        accessToken: user.accessToken,
        refreshToken: user.refreshToken,
        expiresAt: user.tokenExpiresAt,
      });
      // Same reasoning as gscAccounts.ts: persist whatever the client
      // refreshes to, or the stored copy goes stale sync after sync.
      auth.on("tokens", (t) => {
        const update: Partial<typeof schema.users.$inferInsert> = {};
        if (t.access_token) update.accessToken = t.access_token;
        if (t.refresh_token) update.refreshToken = t.refresh_token;
        if (t.expiry_date) update.tokenExpiresAt = new Date(t.expiry_date);
        if (Object.keys(update).length > 0) {
          void db.update(schema.users).set(update).where(eq(schema.users.id, userId));
        }
      });
      return auth;
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private keys carry literal \n when they come from an env var.
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (email && key) {
    const { google } = await import("googleapis");
    return new google.auth.JWT({ email, key, scopes: [SCOPE] });
  }

  throw new GscConfigError(
    "No way to reach Search Console for this client. Either sign in on " +
      "/account with a Google account that has access to the property and " +
      "link it there, or set GOOGLE_SERVICE_ACCOUNT_EMAIL and " +
      "GOOGLE_PRIVATE_KEY and grant that service account read access to it.",
  );
}

type GscRow = {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

/**
 * Bounds a single Google API call (including the OAuth token refresh gaxios
 * makes implicitly on the first call, if the stored access token has
 * expired). Without this, a stalled connection — observed in practice as a
 * hang with no error, distinct from the fast `ENOTFOUND` DNS failure this
 * environment also sometimes produces — leaves `syncStartedAt` claimed
 * indefinitely, with no safe way to recover short of killing the process (and
 * PGlite does not reliably survive being killed mid-write). A clean timeout
 * error is far cheaper than that.
 */
const GSC_REQUEST_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

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

  for (let startRow = 0; ; startRow += ROW_LIMIT) {
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
  const start = await syncStart(clientId, trackedPages.map((p) => p.id), end);

  try {
    const rows = await fetchRows(
      auth,
      client.gscProperty,
      ["page", "date"],
      start,
      end,
    );

    const values: (typeof schema.pageMetrics.$inferInsert)[] = [];
    const unmatched = new Set<string>();

    for (const row of rows) {
      const [url, date] = row.keys ?? [];
      if (!url || !date) continue;

      const pageId = byUrl.get(normaliseUrl(url));
      if (!pageId) {
        unmatched.add(url);
        continue;
      }

      values.push({
        pageId,
        date,
        clicks: Math.round(row.clicks ?? 0),
        impressions: Math.round(row.impressions ?? 0),
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      });
    }

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
      start,
      end,
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
  pageStart: string,
  end: string,
): Promise<number> {
  const db = await getDb();

  const [latest] = await db
    .select({ date: schema.queryMetrics.date })
    .from(schema.queryMetrics)
    .where(eq(schema.queryMetrics.clientId, clientId))
    .orderBy(desc(schema.queryMetrics.date))
    .limit(1);

  const floor = addDays(end, -(INITIAL_BACKFILL_DAYS - 1));
  let start = floor;
  if (latest) {
    const resume = addDays(latest.date, -RESETTLE_DAYS);
    start = resume < floor ? floor : resume;
  }
  // Never reach further back than the page sync already decided to.
  if (start < pageStart && !latest) start = pageStart;

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

/** Resume from just before the newest stored metric, or backfill on first run. */
async function syncStart(
  clientId: string,
  pageIds: string[],
  end: string,
): Promise<string> {
  if (pageIds.length === 0) return addDays(end, -(INITIAL_BACKFILL_DAYS - 1));

  const db = await getDb();
  const [latest] = await db
    .select({ date: schema.pageMetrics.date })
    .from(schema.pageMetrics)
    .where(inArray(schema.pageMetrics.pageId, pageIds))
    .orderBy(desc(schema.pageMetrics.date))
    .limit(1);

  if (!latest) return addDays(end, -(INITIAL_BACKFILL_DAYS - 1));

  const resume = addDays(latest.date, -RESETTLE_DAYS);
  const floor = addDays(end, -(INITIAL_BACKFILL_DAYS - 1));
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
