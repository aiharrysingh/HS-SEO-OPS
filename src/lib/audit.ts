import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Landing page audits (plan §3 Phase 4), implementing the `seo-audit-runner`
 * standard as rules rather than prompts — same decision as reports (§4).
 *
 * The standard's checks are almost entirely mechanical: does robots.txt block
 * an AI crawler, is content present in raw HTML, is there a canonical, is LCP
 * under 2.5s. Those are comparisons, not judgements, and a rule engine states
 * them without the padding that "makes most agency audits worthless".
 *
 * Two things from the standard are deliberately honoured:
 *  - **Findings are template-level**, not per-URL. "All 340 blog posts share one
 *    meta description" is actionable; a 340-row spreadsheet is not.
 *  - **Nothing is claimed without evidence.** Where a check can't be run, it is
 *    reported as not run rather than passed.
 */

const FETCH_TIMEOUT_MS = 15_000;
const SAMPLE_SIZE = 25;
const CONCURRENCY = 4;
const PAUSE_MS = 400;

/** Core Web Vitals thresholds, 75th percentile — straight from the standard. */
const CWV = { lcp: 2500, inp: 200, cls: 0.1 };

/**
 * AI crawlers worth checking by name, because blocking them is usually
 * accidental and the consequences are specific. Blocking `ClaudeBot` does not
 * block `Claude-SearchBot` or `Claude-User`; blocking `OAI-SearchBot` removes
 * the site from ChatGPT search answers entirely.
 */
const AI_CRAWLERS = [
  { name: "GPTBot", note: "OpenAI's training crawler" },
  { name: "OAI-SearchBot", note: "removes the site from ChatGPT search answers" },
  { name: "ClaudeBot", note: "Anthropic's crawler" },
  { name: "Claude-SearchBot", note: "separate from ClaudeBot — blocking one does not block the other" },
  { name: "Claude-User", note: "fetches on a user's behalf" },
  { name: "PerplexityBot", note: "Perplexity's crawler" },
  { name: "Google-Extended", note: "Gemini training, not Search ranking" },
];

export type AuditSeverity = "critical" | "serious" | "warning" | "info";

export type AuditFinding = {
  id: string;
  title: string;
  detail: string;
  evidence: string[];
  severity: AuditSeverity;
  /** The standard's two buckets. */
  bucket: "quick-win" | "strategic";
  effort: string;
};

export type AuditResult = {
  domain: string;
  ranAt: string;
  pagesSampled: number;
  /** Exactly what the audit could see, so a reader knows its limits. */
  sources: string[];
  findings: AuditFinding[];
  notRun: string[];
};

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  critical: 0,
  serious: 1,
  warning: 2,
  info: 3,
};

async function fetchText(
  url: string,
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "HS-SEO-Ops/1.0 (site audit)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
      finalUrl: res.url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ page checks ------------------------------ */

type PageFacts = {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  h1Count: number;
  canonical: string | null;
  noindex: boolean;
  hasJsonLd: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  /** Words in the raw HTML body, scripts and styles removed. */
  bodyWords: number;
  mixedContent: number;
};

const between = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? m[1].trim() : null;
};

export function readPageFacts(url: string, status: number, html: string): PageFacts {
  const title = between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    between(html, /<meta[^>]+name=["']description["'][^>]*\bcontent=["']([^"']*)["']/i) ??
    between(html, /<meta[^>]+\bcontent=["']([^"']*)["'][^>]*name=["']description["']/i);
  const canonical = between(
    html,
    /<link[^>]+rel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i,
  );

  const robotsMeta =
    between(html, /<meta[^>]+name=["']robots["'][^>]*\bcontent=["']([^"']*)["']/i) ?? "";

  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = imgTags.filter((t) => !/\balt\s*=/i.test(t)).length;

  // Strip script/style before counting words, so a client-rendered page's
  // bundle doesn't read as content.
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const mixedContent = (html.match(/(?:src|href)=["']http:\/\//gi) ?? []).length;

  return {
    url,
    status,
    title,
    description,
    h1Count,
    canonical,
    noindex: /noindex/i.test(robotsMeta),
    hasJsonLd: /<script[^>]+application\/ld\+json/i.test(html),
    imagesTotal: imgTags.length,
    imagesMissingAlt,
    bodyWords: body ? body.split(" ").length : 0,
    mixedContent,
  };
}

/* --------------------------- Core Web Vitals ----------------------------- */

type Cwv =
  | { ok: true; lcp: number; inp: number; cls: number; source: "field" | "lab" }
  | { ok: false; reason: string };

/**
 * PageSpeed Insights. Field data (CrUX) is preferred and the source is always
 * reported, because the standard is explicit that lab-only findings mislead.
 *
 * Without `PAGESPEED_API_KEY` the request goes against a shared anonymous
 * quota that is routinely exhausted — a 429 here means "set a key", not "this
 * site has no data", and the two are worth telling apart in the output.
 */
async function fetchCwv(url: string): Promise<Cwv> {
  const key = process.env.PAGESPEED_API_KEY;
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "MOBILE");
  if (key) api.searchParams.set("key", key);

  const res = await fetchText(api.toString());
  if (!res) return { ok: false, reason: "PageSpeed Insights did not respond." };
  if (!res.ok) {
    if (res.status === 429) {
      return {
        ok: false,
        reason: key
          ? "PageSpeed Insights daily quota exceeded for this API key."
          : "PageSpeed Insights quota exceeded on the shared anonymous allowance — set PAGESPEED_API_KEY to get your own.",
      };
    }
    return { ok: false, reason: `PageSpeed Insights returned HTTP ${res.status}.` };
  }

  try {
    const data = JSON.parse(res.text) as {
      loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
      lighthouseResult?: { audits?: Record<string, { numericValue?: number }> };
    };

    const field = data.loadingExperience?.metrics;
    if (field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile !== undefined) {
      return {
        ok: true,
        lcp: field.LARGEST_CONTENTFUL_PAINT_MS.percentile ?? 0,
        inp: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? 0,
        cls: (field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? 0) / 100,
        source: "field",
      };
    }

    const lab = data.lighthouseResult?.audits;
    if (lab?.["largest-contentful-paint"]?.numericValue !== undefined) {
      return {
        ok: true,
        lcp: lab["largest-contentful-paint"].numericValue ?? 0,
        inp: lab["total-blocking-time"]?.numericValue ?? 0,
        cls: lab["cumulative-layout-shift"]?.numericValue ?? 0,
        source: "lab",
      };
    }
  } catch {
    // Fall through — a malformed response is a check that didn't run.
  }
  return { ok: false, reason: "PageSpeed Insights returned no usable metrics." };
}

/* -------------------------------- runner --------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAudit(clientId: string): Promise<AuditResult> {
  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) throw new Error(`No client ${clientId}`);

  const origin = `https://${client.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const findings: AuditFinding[] = [];
  const sources: string[] = [];
  const notRun: string[] = [];

  /* robots.txt ---------------------------------------------------------- */
  const robots = await fetchText(`${origin}/robots.txt`);
  if (!robots || !robots.ok) {
    notRun.push("robots.txt could not be fetched");
  } else {
    sources.push("robots.txt");
    const text = robots.text;

    // Group directives by user-agent so a disallow is attributed correctly.
    const groups: { agents: string[]; disallows: string[] }[] = [];
    let current: { agents: string[]; disallows: string[] } | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const ua = line.match(/^user-agent:\s*(.+)$/i);
      if (ua) {
        if (!current || current.disallows.length > 0) {
          current = { agents: [], disallows: [] };
          groups.push(current);
        }
        current.agents.push(ua[1].trim().toLowerCase());
        continue;
      }
      const dis = line.match(/^disallow:\s*(.*)$/i);
      if (dis && current) current.disallows.push(dis[1].trim());
    }

    const blocksEverything = (g: { disallows: string[] }) =>
      g.disallows.some((d) => d === "/");

    const wildcard = groups.find((g) => g.agents.includes("*"));
    if (wildcard && blocksEverything(wildcard)) {
      findings.push({
        id: "robots-blanket-disallow",
        title: "robots.txt blocks the entire site for all crawlers",
        detail:
          "A `Disallow: /` under `User-agent: *` tells every crawler to stay out. " +
          "Unless this is a staging site, nothing else in this audit matters until it is removed.",
        evidence: [`${origin}/robots.txt contains "Disallow: /" for User-agent: *`],
        severity: "critical",
        bucket: "quick-win",
        effort: "minutes",
      });
    }

    const blockedAi = AI_CRAWLERS.filter((c) => {
      const g = groups.find((x) => x.agents.includes(c.name.toLowerCase()));
      return g ? blocksEverything(g) : false;
    });

    if (blockedAi.length > 0) {
      findings.push({
        id: "robots-blocks-ai-crawlers",
        title: `robots.txt blocks ${blockedAi.length} AI crawler${blockedAi.length === 1 ? "" : "s"}`,
        detail:
          "These are usually blocked by accident, often by a plugin default. Each " +
          "name is a separate agent — blocking one does not block the others. " +
          "Decide deliberately whether the site should appear in AI answers.",
        evidence: blockedAi.map((c) => `${c.name} — ${c.note}`),
        severity: "serious",
        bucket: "quick-win",
        effort: "minutes",
      });
    } else if (wildcard && !blocksEverything(wildcard)) {
      findings.push({
        id: "robots-ai-crawlers-allowed",
        title: "AI crawlers are not blocked",
        detail:
          "No explicit block on GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, " +
          "Claude-User or PerplexityBot. Nothing to fix — recorded so a future " +
          "audit can tell if that changes.",
        evidence: ["robots.txt has no blanket disallow for the named AI agents"],
        severity: "info",
        bucket: "quick-win",
        effort: "none",
      });
    }

    if (!/sitemap:/i.test(text)) {
      findings.push({
        id: "robots-no-sitemap",
        title: "robots.txt does not reference a sitemap",
        detail:
          "A `Sitemap:` line is how a crawler finds the sitemap without guessing. " +
          "Cheap to add and it removes a discovery dependency.",
        evidence: [`No "Sitemap:" directive in ${origin}/robots.txt`],
        severity: "warning",
        bucket: "quick-win",
        effort: "minutes",
      });
    }
  }

  /* sitemap -------------------------------------------------------------- */
  const sitemapUrl =
    robots?.text.match(/sitemap:\s*(\S+)/i)?.[1] ?? `${origin}/sitemap.xml`;
  const sitemap = await fetchText(sitemapUrl);
  if (!sitemap || !sitemap.ok) {
    findings.push({
      id: "sitemap-missing",
      title: "No reachable XML sitemap",
      detail:
        "Nothing was served at the expected sitemap location. Crawlers fall back " +
        "to link discovery, which reaches deep and orphaned pages slowly or not at all.",
      evidence: [`${sitemapUrl} returned ${sitemap ? sitemap.status : "no response"}`],
      severity: "serious",
      bucket: "quick-win",
      effort: "hours",
    });
  } else {
    sources.push("XML sitemap");
  }

  /* page sample ---------------------------------------------------------- */
  const trackedPages = await db
    .select({ url: schema.pages.url, type: schema.pages.type })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId))
    .limit(400);

  // Sample across the list rather than the first N, so one template doesn't
  // stand in for the whole site.
  const step = Math.max(1, Math.floor(trackedPages.length / SAMPLE_SIZE));
  const sample = trackedPages.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);

  const facts: PageFacts[] = [];
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const slice = sample.slice(i, i + CONCURRENCY);
    const got = await Promise.all(
      slice.map(async (p) => {
        const res = await fetchText(p.url);
        if (!res) return null;
        return readPageFacts(p.url, res.status, res.text);
      }),
    );
    facts.push(...got.filter((f): f is PageFacts => f !== null));
    if (i + CONCURRENCY < sample.length) await sleep(PAUSE_MS);
  }

  if (facts.length === 0) {
    notRun.push("No pages could be fetched, so on-page checks did not run");
  } else {
    sources.push(`${facts.length} pages fetched and parsed`);

    const pct = (n: number) => Math.round((n / facts.length) * 100);

    // JS rendering — the standard calls this the most valuable finding when
    // it fires, because ~69% of AI crawlers cannot execute JavaScript.
    const thinRaw = facts.filter((f) => f.bodyWords < 200);
    if (thinRaw.length >= facts.length * 0.5) {
      findings.push({
        id: "client-rendered",
        title: "Content is not present in the raw HTML",
        detail:
          "Most sampled pages return almost no readable text before JavaScript runs. " +
          "Roughly 69% of AI crawlers — including GPTBot, OAI-SearchBot, ClaudeBot, " +
          "Claude-SearchBot and PerplexityBot — cannot execute JavaScript, so the " +
          "content is invisible to them however good it is. Gemini is the exception, " +
          "because it uses Googlebot's renderer.",
        evidence: [
          `${thinRaw.length} of ${facts.length} sampled pages have under 200 words in raw HTML`,
          `Median raw word count: ${median(facts.map((f) => f.bodyWords))}`,
        ],
        severity: "critical",
        bucket: "strategic",
        effort: "weeks — needs server-side rendering or pre-rendering",
      });
    }

    const noTitle = facts.filter((f) => !f.title);
    if (noTitle.length > 0) {
      findings.push({
        id: "missing-titles",
        title: `${noTitle.length} of ${facts.length} sampled pages have no title`,
        detail: "A missing title leaves Google to invent one from page content.",
        evidence: noTitle.slice(0, 5).map((f) => f.url),
        severity: "serious",
        bucket: "quick-win",
        effort: "hours",
      });
    }

    const dupTitles = duplicates(facts.map((f) => f.title).filter(Boolean) as string[]);
    if (dupTitles.length > 0) {
      findings.push({
        id: "duplicate-titles",
        title: "Sampled pages share the same title",
        detail:
          "Duplicate titles across a template make pages compete with each other " +
          "and give no reason to click one over another.",
        evidence: dupTitles.slice(0, 4).map(([t, n]) => `${n}× "${t}"`),
        severity: "warning",
        bucket: "quick-win",
        effort: "days",
      });
    }

    const noDesc = facts.filter((f) => !f.description);
    if (noDesc.length >= facts.length * 0.25) {
      findings.push({
        id: "missing-descriptions",
        title: `${pct(noDesc.length)}% of sampled pages have no meta description`,
        detail:
          "Google writes its own snippet when there isn't one, which is often a " +
          "worse pitch than the one you'd write.",
        evidence: noDesc.slice(0, 5).map((f) => f.url),
        severity: "warning",
        bucket: "quick-win",
        effort: "days",
      });
    }

    const badH1 = facts.filter((f) => f.h1Count !== 1);
    if (badH1.length >= facts.length * 0.3) {
      findings.push({
        id: "h1-problems",
        title: `${pct(badH1.length)}% of sampled pages have zero or multiple H1s`,
        detail:
          "One H1 per page states the subject unambiguously. This is a template " +
          "issue, not a per-page one.",
        evidence: badH1.slice(0, 5).map((f) => `${f.url} — ${f.h1Count} H1s`),
        severity: "warning",
        bucket: "quick-win",
        effort: "hours — template change",
      });
    }

    const noCanonical = facts.filter((f) => !f.canonical);
    if (noCanonical.length >= facts.length * 0.25) {
      findings.push({
        id: "missing-canonical",
        title: `${pct(noCanonical.length)}% of sampled pages have no canonical tag`,
        detail:
          "Without a self-referencing canonical, parameter and variant URLs can " +
          "split signals between duplicates of the same page.",
        evidence: noCanonical.slice(0, 5).map((f) => f.url),
        severity: "warning",
        bucket: "quick-win",
        effort: "hours — template change",
      });
    }

    const noindexed = facts.filter((f) => f.noindex);
    if (noindexed.length > 0) {
      findings.push({
        id: "noindex-pages",
        title: `${noindexed.length} sampled page${noindexed.length === 1 ? " carries" : "s carry"} a noindex`,
        detail:
          "These pages cannot rank. Confirm each is deliberate — an accidental " +
          "template-level noindex is one of the most expensive mistakes on this list.",
        evidence: noindexed.slice(0, 5).map((f) => f.url),
        severity: "critical",
        bucket: "quick-win",
        effort: "minutes once confirmed",
      });
    }

    const noSchema = facts.filter((f) => !f.hasJsonLd);
    if (noSchema.length >= facts.length * 0.5) {
      findings.push({
        id: "no-structured-data",
        title: `${pct(noSchema.length)}% of sampled pages have no structured data`,
        detail:
          "Schema.org markup helps engines identify what a page is about. Note that " +
          "FAQ and HowTo rich results no longer exist — FAQPage remains valid markup " +
          "with no SERP enhancement, so don't add it expecting stars back.",
        evidence: noSchema.slice(0, 5).map((f) => f.url),
        severity: "warning",
        bucket: "strategic",
        effort: "days",
      });
    }

    const altIssues = facts.filter((f) => f.imagesMissingAlt > 0);
    if (altIssues.length >= facts.length * 0.4) {
      const total = facts.reduce((a, f) => a + f.imagesMissingAlt, 0);
      findings.push({
        id: "missing-alt-text",
        title: `${total} images without alt text across the sample`,
        detail:
          "Alt text is an accessibility requirement first and an image-search signal second.",
        evidence: altIssues
          .slice(0, 4)
          .map((f) => `${f.url} — ${f.imagesMissingAlt} of ${f.imagesTotal} images`),
        severity: "warning",
        bucket: "quick-win",
        effort: "days",
      });
    }

    const mixed = facts.filter((f) => f.mixedContent > 0);
    if (mixed.length > 0) {
      findings.push({
        id: "mixed-content",
        title: "Pages reference resources over plain http://",
        detail:
          "Mixed content is blocked or downgraded by browsers and undermines the " +
          "padlock on an otherwise secure page.",
        evidence: mixed
          .slice(0, 4)
          .map((f) => `${f.url} — ${f.mixedContent} http:// references`),
        severity: "serious",
        bucket: "quick-win",
        effort: "hours",
      });
    }
  }

  /* Core Web Vitals ------------------------------------------------------ */
  const cwv = await fetchCwv(origin);
  if (!cwv.ok) {
    notRun.push(`Core Web Vitals — ${cwv.reason}`);
  } else {
    sources.push(
      `Core Web Vitals (${cwv.source === "field" ? "CrUX field data" : "lab data only"})`,
    );
    const fails: string[] = [];
    if (cwv.lcp > CWV.lcp) fails.push(`LCP ${(cwv.lcp / 1000).toFixed(1)}s (target ≤ 2.5s)`);
    if (cwv.source === "field" && cwv.inp > CWV.inp)
      fails.push(`INP ${Math.round(cwv.inp)}ms (target ≤ 200ms)`);
    if (cwv.cls > CWV.cls) fails.push(`CLS ${cwv.cls.toFixed(2)} (target ≤ 0.10)`);

    if (fails.length > 0) {
      findings.push({
        id: "core-web-vitals",
        title: `Core Web Vitals failing on ${fails.length} metric${fails.length === 1 ? "" : "s"}`,
        detail:
          cwv.source === "field"
            ? "Measured from real visitors at the 75th percentile."
            : "**Lab data only** — no real-visitor data was available for this origin, " +
              "and lab and field results diverge. Treat as directional.",
        evidence: fails,
        severity: cwv.source === "field" ? "serious" : "warning",
        bucket: "strategic",
        effort: "days to weeks",
      });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.bucket === b.bucket ? 0 : a.bucket === "quick-win" ? -1 : 1),
  );

  return {
    domain: client.domain,
    ranAt: new Date().toISOString(),
    pagesSampled: facts.length,
    sources,
    findings,
    notRun,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function duplicates(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
}

/** Runs an audit and stores it, so audits are comparable over time (plan §3). */
export async function runAndStoreAudit(clientId: string) {
  const result = await runAudit(clientId);
  const db = await getDb();
  const [row] = await db
    .insert(schema.audits)
    .values({
      clientId,
      url: `https://${result.domain}`,
      findings: result,
    })
    .returning();
  return { auditId: row.id, result };
}
