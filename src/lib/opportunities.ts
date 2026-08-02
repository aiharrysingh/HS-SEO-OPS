import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DateWindow } from "./dates";
import { brandMatcher } from "./brand";

/**
 * Phase 3's evidence layer: which search terms are worth writing for.
 *
 * The plan's brief is "a year of *this piece earned these clicks* rather than
 * instinct". Two questions fall out of that, and they need different answers:
 *
 *  - **Improve** — a term already ranking at positions 5–20. Google is willing
 *    to show the site for it; the page just isn't good enough yet. Cheapest
 *    wins on the list, because the hard part (being considered at all) is done.
 *  - **Create** — a term with real impressions that nothing on the site
 *    targets. More work, but it's demand that currently earns nothing.
 *
 * Branded terms are excluded from both. A brand already ranks first for its own
 * name; putting it top of a content-opportunity list is noise that buries the
 * terms the work can actually move.
 */

/**
 * Positions 5–20, straight from plan §3. Above 5 there is little headroom;
 * below 20 the term is effectively unranked and belongs in a different, much
 * more speculative conversation.
 */
const OPPORTUNITY_MIN_POSITION = 5;
const OPPORTUNITY_MAX_POSITION = 20;

/** Below this the term is noise — a handful of impressions proves nothing. */
const MIN_IMPRESSIONS = 30;

export type Opportunity = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /**
   * The page whose target keyword or title best matches, if any.
   *
   * A *text* match, not Search Console attribution. We store query data at
   * site level (page × query would blow through GSC's 50k pairs/day ceiling),
   * so this cannot say which page actually ranks — only which page looks like
   * it was written for the term. Surfaced as a hint, and labelled as one.
   */
  matchedPage: { id: string; title: string; url: string } | null;
  kind: "improve" | "create";
};

/** Words too common to carry meaning in a title match. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "your",
  "best", "how", "what", "why", "is", "are", "vs", "top", "you", "we", "my",
]);

/**
 * Crude singularisation, deliberately not a real stemmer.
 *
 * Without it "llm leaderboard" fails to match a page titled "…LLM
 * Leaderboards" and the term is reported as unaddressed — telling you to write
 * a piece you already published. Plural/singular is far and away the common
 * case in search terms; a full stemmer would add a dependency to fix the long
 * tail of a problem this handles.
 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && (t.endsWith("ses") || t.endsWith("xes") || t.endsWith("ches")))
    return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** Spacing-insensitive form, so "chat got" can meet "chatgot". */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best-matching page for a query, by token overlap against target keyword,
 * title and URL slug.
 *
 * Requires a majority of the query's meaningful words to appear. A single
 * shared word ("services") would otherwise match half the site and make the
 * "nothing targets this" signal worthless.
 */
function matchPage(
  query: string,
  pages: { id: string; title: string; url: string; targetKeyword: string | null }[],
): { id: string; title: string; url: string } | null {
  const qt = tokens(query);
  if (qt.length === 0) return null;
  const qSquashed = squash(query);

  let best: { page: (typeof pages)[number]; score: number } | null = null;

  for (const p of pages) {
    const slug = p.url.replace(/^https?:\/\/[^/]+/, "");
    const hay = new Set([
      ...tokens(p.targetKeyword ?? ""),
      ...tokens(p.title),
      ...tokens(slug),
    ]);
    if (hay.size === 0) continue;

    const hits = qt.filter((t) => hay.has(t)).length;
    let score = hits / qt.length;

    // A run-together term ("chatgot") never tokenises to match its spaced form,
    // so check the squashed haystack too and treat a hit as conclusive.
    if (score < 1 && qSquashed.length >= 6) {
      const haySquashed = squash(`${p.targetKeyword ?? ""} ${p.title} ${slug}`);
      if (haySquashed.includes(qSquashed)) score = 1;
    }

    if (score >= 0.6 && (!best || score > best.score)) {
      best = { page: p, score };
    }
  }

  return best ? { id: best.page.id, title: best.page.title, url: best.page.url } : null;
}

export async function getOpportunities(
  clientId: string,
  window: DateWindow,
  limit = 100,
): Promise<Opportunity[]> {
  const db = await getDb();

  const [client] = await db
    .select({ brandTerms: schema.clients.brandTerms, domain: schema.clients.domain, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) return [];

  const rows = await db
    .select({
      query: schema.queryMetrics.query,
      clicks: sql<number>`coalesce(sum(${schema.queryMetrics.clicks}), 0)::int`,
      impressions: sql<number>`coalesce(sum(${schema.queryMetrics.impressions}), 0)::int`,
      position: sql<number>`sum(${schema.queryMetrics.position} * ${schema.queryMetrics.impressions})
          / nullif(sum(${schema.queryMetrics.impressions}), 0)`,
    })
    .from(schema.queryMetrics)
    .where(
      and(
        eq(schema.queryMetrics.clientId, clientId),
        gte(schema.queryMetrics.date, window.start),
        lte(schema.queryMetrics.date, window.end),
      ),
    )
    .groupBy(schema.queryMetrics.query)
    .having(
      sql`sum(${schema.queryMetrics.impressions}) >= ${MIN_IMPRESSIONS}
          and sum(${schema.queryMetrics.position} * ${schema.queryMetrics.impressions})
              / nullif(sum(${schema.queryMetrics.impressions}), 0)
              between ${OPPORTUNITY_MIN_POSITION} and ${OPPORTUNITY_MAX_POSITION}`,
    );

  const pages = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      url: schema.pages.url,
      targetKeyword: schema.pages.targetKeyword,
    })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId));

  const brand = brandMatcher(client.brandTerms);

  return rows
    .filter((r) => !brand.isBranded(r.query))
    .map((r) => {
      const impressions = Number(r.impressions);
      const clicks = Number(r.clicks);
      const matchedPage = matchPage(r.query, pages);
      return {
        query: r.query,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: Number(r.position ?? 0),
        matchedPage,
        kind: matchedPage ? ("improve" as const) : ("create" as const),
      };
    })
    // Impressions first: the term nobody sees is not an opportunity, however
    // good its position.
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

export type PlannedPage = {
  id: string;
  title: string;
  url: string;
  targetKeyword: string | null;
  plannedFor: string | null;
  type: "blog" | "landing";
};

/**
 * The content calendar.
 *
 * Planned pieces are `pages` rows with `status = "draft"` and `publishedAt`
 * holding the *intended* date — no new table, per plan §5. When a piece goes
 * live the row flips to `status = "live"` and the same date becomes its real
 * go-live date, which is exactly what the milestone columns already measure
 * from. One row, one lifecycle.
 */
export async function getPlannedContent(clientId: string): Promise<PlannedPage[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      url: schema.pages.url,
      targetKeyword: schema.pages.targetKeyword,
      plannedFor: schema.pages.publishedAt,
      type: schema.pages.type,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.clientId, clientId), eq(schema.pages.status, "draft")))
    .orderBy(schema.pages.publishedAt);

  return rows as PlannedPage[];
}
