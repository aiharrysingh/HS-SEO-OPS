import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dataCutoff, toIsoDate } from "./dates";
import { titleFromUrl } from "./gsc";

/**
 * Filling in publish dates so the milestone columns can work.
 *
 * Milestones measure from go-live, so a page with no `published_at` shows
 * nothing at week 1, month 1, month 3 or month 6 — which is every page after a
 * bulk import, because Search Console has no concept of a publish date.
 *
 * **Only dates a page states about itself are accepted.** Structured metadata
 * (`article:published_time`, schema.org `datePublished`) is the page's own
 * claim and is trustworthy. Sitemap `lastmod` is deliberately *not* used: it
 * records last modification, so any updated post would be dated recently, and
 * a wrong publish date doesn't fail loudly — it silently produces a wrong
 * "month 3" number that reads as real. Anything ambiguous is left null for a
 * human, matching the existing rule that publish dates are curated.
 */

const FETCH_TIMEOUT_MS = 15_000;

/** Politeness: these are client sites, not ours to hammer. */
const CONCURRENCY = 4;

/**
 * A breather between batches. Observed in practice: running flat out at
 * concurrency 6 got roughly 1,200 pages in before the origin began refusing
 * everything, which is the tool causing an outage-shaped event on a client's
 * production site to fill in a metadata column.
 */
const PAUSE_BETWEEN_BATCHES_MS = 400;

/**
 * When most of a batch fails, the site is almost certainly rate-limiting
 * rather than every page having broken at once. Continuing would keep pushing
 * a server that is already saying no, so the run stops and says why.
 */
const FAILURE_RATE_ABORT = 0.7;
const MIN_BATCHES_BEFORE_ABORT = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nothing before this is a plausible publish date for a page we track. */
const EARLIEST_PLAUSIBLE = "1995-01-01";

/**
 * The page's own `<title>`, which is the real thing rather than a guess.
 *
 * Import derives a title from the URL slug because Search Console only returns
 * URLs — so "Web Development Life Cycle" was inferred, not read. Since this
 * pass already downloads every page, taking the actual title costs nothing and
 * replaces a derived value with a true one.
 */
export function detectTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const title = m[1]
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .trim();
  return title.length > 0 && title.length <= 300 ? title : null;
}

export type DateDetectionResult = {
  scanned: number;
  dated: number;
  /** Pages whose derived title was replaced with the page's real one. */
  titled: number;
  /** Fetched fine but stated no publish date we trust. */
  undated: number;
  failed: number;
  /** Pages still missing a date after this run. */
  remaining: number;
  /** Set when the run backed off early, e.g. the site started refusing requests. */
  stoppedEarly: string | null;
  samples: { url: string; date: string; source: string }[];
};

/** Normalises anything date-like to `YYYY-MM-DD`, or null if implausible. */
function toPlausibleIsoDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  const iso = toIsoDate(parsed);
  // A future date, or one before the web as we know it, is a parsing artefact
  // rather than a publish date — drop it rather than store a lie.
  if (iso < EARLIEST_PLAUSIBLE || iso > dataCutoff()) return null;
  return iso;
}

/** Walks nested JSON-LD (graphs, arrays) for the first usable `datePublished`. */
function findDatePublished(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findDatePublished(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  for (const key of ["datePublished", "dateCreated"]) {
    const value = obj[key];
    if (typeof value === "string") {
      const iso = toPlausibleIsoDate(value);
      if (iso) return iso;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const hit = findDatePublished(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Extracts a stated publish date from a page's HTML.
 *
 * Ordered by how directly each source asserts "this is when it was published".
 */
export function detectPublishDate(
  html: string,
): { date: string; source: string } | null {
  // 1. OpenGraph article metadata — unambiguous, and what most CMSs emit.
  const og = html.match(
    /<meta[^>]+(?:property|name)=["']article:published_time["'][^>]*\bcontent=["']([^"']+)["']/i,
  );
  const ogDate = toPlausibleIsoDate(og?.[1]);
  if (ogDate) return { date: ogDate, source: "article:published_time" };

  // 2. schema.org datePublished, anywhere in any JSON-LD block.
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      const hit = findDatePublished(JSON.parse(block[1].trim()));
      if (hit) return { date: hit, source: "schema.org datePublished" };
    } catch {
      // Malformed JSON-LD is common and not worth failing the whole page over.
    }
  }

  // 3. A <time> element explicitly marked as the publish date.
  const timeEl = html.match(
    /<time[^>]+itemprop=["']datePublished["'][^>]*\bdatetime=["']([^"']+)["']/i,
  );
  const timeDate = toPlausibleIsoDate(timeEl?.[1]);
  if (timeDate) return { date: timeDate, source: "time[itemprop=datePublished]" };

  // Deliberately no fallback to <meta name="date">, URL date patterns or
  // sitemap lastmod: each is a guess, and a wrong publish date is worse than
  // an absent one because the milestone numbers it produces look real.
  return null;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identify honestly rather than impersonating a browser.
        "User-Agent": "HS-SEO-Ops/1.0 (publish-date detection)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fills in publish dates for a client's undated pages.
 *
 * Bounded per call (`limit`) and reports what is left, so a large site is
 * worked through in visible increments rather than one request that runs for
 * minutes and might time out halfway with nothing to show for it.
 */
export async function detectPublishDatesForClient(
  clientId: string,
  { limit = 300 }: { limit?: number } = {},
): Promise<DateDetectionResult> {
  const db = await getDb();

  const undatedPages = await db
    .select({
      id: schema.pages.id,
      url: schema.pages.url,
      title: schema.pages.title,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.clientId, clientId),
        isNull(schema.pages.publishedAt),
        // Drafts are planned content; their date is a human's intention, not
        // something to go and discover.
        ne(schema.pages.status, "draft"),
      ),
    );

  const batch = undatedPages.slice(0, limit);
  let dated = 0;
  let titled = 0;
  let undated = 0;
  let failed = 0;
  const samples: { url: string; date: string; source: string }[] = [];

  let scanned = 0;
  let consecutiveBadBatches = 0;
  let stoppedEarly: string | null = null;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (page) => {
        const html = await fetchHtml(page.url);
        if (html === null)
          return { page, found: null, realTitle: null, failed: true };
        return {
          page,
          found: detectPublishDate(html),
          realTitle: detectTitle(html),
          failed: false,
        };
      }),
    );
    scanned += slice.length;

    let failedInBatch = 0;
    for (const r of results) {
      if (r.failed) {
        failed++;
        failedInBatch++;
        continue;
      }

      /**
       * Only replace a title that is still the slug-derived guess.
       *
       * Anything else has been curated by a person — overwriting their wording
       * with whatever the CMS puts in `<title>` would quietly undo real work.
       */
      const update: Partial<typeof schema.pages.$inferInsert> = {};
      if (
        r.realTitle &&
        r.realTitle !== r.page.title &&
        r.page.title === titleFromUrl(r.page.url)
      ) {
        update.title = r.realTitle;
        titled++;
      }

      if (!r.found) {
        if (Object.keys(update).length > 0) {
          await db
            .update(schema.pages)
            .set(update)
            .where(eq(schema.pages.id, r.page.id));
        }
        undated++;
        continue;
      }
      update.publishedAt = r.found.date;
      await db
        .update(schema.pages)
        .set(update)
        .where(eq(schema.pages.id, r.page.id));
      dated++;
      if (samples.length < 5) {
        samples.push({
          url: r.page.url,
          date: r.found.date,
          source: r.found.source,
        });
      }
    }

    if (failedInBatch / slice.length >= FAILURE_RATE_ABORT) {
      consecutiveBadBatches++;
      if (consecutiveBadBatches >= MIN_BATCHES_BEFORE_ABORT) {
        stoppedEarly =
          "The site stopped responding to most requests, which usually means " +
          "it is rate-limiting us. Stopped rather than keep pushing — wait a " +
          "few minutes and run again.";
        break;
      }
    } else {
      consecutiveBadBatches = 0;
    }

    if (i + CONCURRENCY < batch.length) await sleep(PAUSE_BETWEEN_BATCHES_MS);
  }

  return {
    scanned,
    dated,
    titled,
    undated,
    failed,
    remaining: undatedPages.length - dated,
    stoppedEarly,
    samples,
  };
}
