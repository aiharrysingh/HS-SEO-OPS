/**
 * Demo data for local development.
 *
 * The numbers are shaped like real organic traffic, not random noise: pages
 * ramp over months rather than landing at full volume, weekends dip, position
 * improves slowly, and a realistic share of pages simply never take off. A
 * tracker that looks convincing on flat random data will mislead you about
 * whether the UI actually surfaces anything useful.
 *
 * Run with `npm run db:seed`. Safe to re-run — it clears the tables first.
 */
import "./env";
import { getDb, schema } from "./index";
import { addDays, dataCutoff, toIsoDate } from "../lib/dates";
import { deriveBrandTerms } from "../lib/brand";
import { referencesConfigured } from "../lib/references";
import { generateReportForClient } from "../lib/reports";

/** Deterministic PRNG so re-seeding gives the same demo every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How a page behaves over its life. Roughly the mix you see in a real portfolio. */
type Archetype = "winner" | "sleeper" | "decayer" | "steady" | "dud";

const ARCHETYPE_PEAK: Record<Archetype, number> = {
  winner: 95,
  sleeper: 48,
  decayer: 60,
  steady: 22,
  dud: 2,
};

/**
 * Share of peak traffic at `age` days old. SEO pages take months to mature —
 * this is the single most important thing to get right for the tracker to mean
 * anything.
 */
function maturity(archetype: Archetype, age: number): number {
  if (age < 0) return 0;
  switch (archetype) {
    case "winner":
      // Steady climb, plateauing around month 4.
      return Math.min(1, 0.05 + age / 120);
    case "sleeper":
      // Nothing for ~10 weeks, then Google decides it likes the page.
      return age < 70 ? 0.08 : Math.min(1, 0.08 + (age - 70) / 60);
    case "decayer":
      // Early spike (promotion, freshness) then a slow slide.
      return age < 45 ? Math.min(1, 0.2 + age / 50) : Math.max(0.35, 1 - (age - 45) / 260);
    case "steady":
      return Math.min(1, 0.3 + age / 200);
    case "dud":
      return Math.min(1, age / 90);
  }
}

/** Average SERP position, improving as the page matures. */
function positionFor(archetype: Archetype, m: number): number {
  const floor = archetype === "winner" ? 3.2 : archetype === "dud" ? 42 : 8;
  return floor + (46 - floor) * (1 - m);
}

const CLIENTS = [
  {
    name: "Northwind Hotels",
    domain: "northwindhotels.co.uk",
    gscProperty: "sc-domain:northwindhotels.co.uk",
    // Left null on purpose: a fake property id would make the Analytics screen
    // look configured and then fail against Google rather than showing its
    // "link a property" empty state.
    ga4PropertyId: null as string | null,
    branding: { primaryColor: "#0f766e" },
    seed: 11,
    // Hospitality skews heavily branded — people search the hotel by name.
    brandShare: 0.34,
    brandQueries: [
      "northwind hotels",
      "northwind hotel lake district",
      "northwind hotels booking",
      "northwind ambleside",
      "north wind hotels",
    ],
    /**
     * Informational queries losing clicks while impressions hold — the AI
     * Overview signature the client-report skill calls out as one of the most
     * commonly misdiagnosed causes. Seeded so the detector has something real
     * to find rather than being untestable.
     */
    aiPressured: ["things to do ambleside rain", "lake district packing list"],
    pages: [
      ["landing", "Boutique Hotels in the Lake District", "boutique hotels lake district", "/lake-district", "winner"],
      ["landing", "Dog Friendly Hotels — Northwind", "dog friendly hotels", "/dog-friendly", "winner"],
      ["landing", "Spa Breaks & Weekend Packages", "spa breaks uk", "/spa-breaks", "steady"],
      ["landing", "Wedding Venues in Cumbria", "wedding venues cumbria", "/weddings", "sleeper"],
      ["blog", "14 Things to Do in Ambleside When It Rains", "things to do ambleside rain", "/blog/ambleside-rain", "winner"],
      ["blog", "The Best Walks Near Windermere, Ranked", "walks near windermere", "/blog/windermere-walks", "winner"],
      ["blog", "Lake District Packing List for Autumn", "lake district packing list", "/blog/autumn-packing", "decayer"],
      ["blog", "Where to Eat in Keswick: A Local's Guide", "restaurants keswick", "/blog/keswick-food", "steady"],
      ["blog", "How to Get to the Lake District Without a Car", "lake district without car", "/blog/no-car", "sleeper"],
      ["blog", "Our Winter Opening Hours", "northwind winter hours", "/blog/winter-hours", "dud"],
      ["blog", "Northwind Wins Regional Hotel of the Year", "northwind hotel award", "/blog/hotel-of-the-year", "dud"],
      ["blog", "A Short History of the Windermere Ferry", "windermere ferry history", "/blog/ferry-history", "steady"],
    ],
  },
  {
    name: "Bramble & Fern",
    domain: "brambleandfern.com",
    gscProperty: "sc-domain:brambleandfern.com",
    ga4PropertyId: null as string | null,
    branding: { primaryColor: "#4d7c0f" },
    seed: 27,
    brandShare: 0.16,
    brandQueries: [
      "bramble and fern",
      "bramble & fern raised beds",
      "brambleandfern",
    ],
    aiPressured: ["when to sow tomatoes uk", "how deep raised bed"],
    pages: [
      ["landing", "Raised Garden Beds — Handmade in the UK", "raised garden beds uk", "/raised-beds", "winner"],
      ["landing", "Cold Frames & Cloches", "cold frames for sale", "/cold-frames", "steady"],
      ["landing", "Greenhouse Staging", "greenhouse staging", "/staging", "decayer"],
      ["blog", "When to Sow Tomatoes in the UK", "when to sow tomatoes uk", "/blog/sow-tomatoes", "winner"],
      ["blog", "No-Dig Gardening: An Honest Beginner's Guide", "no dig gardening", "/blog/no-dig", "winner"],
      ["blog", "How Deep Should a Raised Bed Be?", "how deep raised bed", "/blog/raised-bed-depth", "sleeper"],
      ["blog", "Slug Control That Actually Works", "slug control garden", "/blog/slugs", "decayer"],
      ["blog", "Cedar vs Scaffold Board: Which Lasts Longer?", "cedar vs scaffold board", "/blog/cedar-vs-scaffold", "sleeper"],
      ["blog", "What to Plant in October", "what to plant october", "/blog/october-planting", "decayer"],
      ["blog", "Our New Workshop in Frome", "bramble fern workshop", "/blog/frome-workshop", "dud"],
      ["blog", "Composting in a Small Garden", "small garden composting", "/blog/small-composting", "steady"],
    ],
  },
  {
    name: "Kestrel Legal",
    domain: "kestrellegal.co.uk",
    gscProperty: "sc-domain:kestrellegal.co.uk",
    ga4PropertyId: null as string | null,
    branding: { primaryColor: "#1d4ed8" },
    seed: 43,
    brandShare: 0.11,
    brandQueries: ["kestrel legal", "kestrel legal bristol", "kestrel solicitors"],
    aiPressured: ["unfair dismissal time limit", "garden leave explained"],
    pages: [
      ["landing", "Employment Solicitors in Bristol", "employment solicitors bristol", "/employment", "winner"],
      ["landing", "Settlement Agreement Advice", "settlement agreement solicitor", "/settlement-agreements", "winner"],
      ["landing", "Unfair Dismissal Claims", "unfair dismissal solicitor", "/unfair-dismissal", "sleeper"],
      ["blog", "How Long Do You Have to Claim Unfair Dismissal?", "unfair dismissal time limit", "/blog/dismissal-time-limit", "winner"],
      ["blog", "What Is a Settlement Agreement Worth?", "settlement agreement value", "/blog/settlement-value", "steady"],
      ["blog", "Redundancy Consultation: Your Rights", "redundancy consultation rights", "/blog/redundancy-consultation", "sleeper"],
      ["blog", "Can My Employer Change My Contract?", "employer change contract", "/blog/contract-changes", "steady"],
      ["blog", "Kestrel Legal Named in Legal 500", "kestrel legal 500", "/blog/legal-500", "dud"],
      ["blog", "Garden Leave Explained", "garden leave explained", "/blog/garden-leave", "decayer"],
    ],
  },
] as const;

/**
 * Metrics history depth. Needs to exceed a year plus the longest window, or
 * year-on-year has nothing to compare against and every report says so.
 */
const HISTORY_DAYS = 560;

/**
 * When the seeded AI Overview click compression arrives.
 *
 * Modelled as a rollout, not a slow drift: nothing before day 21, ramping to
 * full by day 7, steady after. That shape matters — a gradual months-long ramp
 * looks almost identical in a window and its predecessor, so period-on-period
 * detection finds nothing and the detector is never actually exercised. A real
 * AI Overview appears on a query cluster over days.
 */
const AI_PRESSURE_ONSET_DAYS = 14;
const AI_PRESSURE_FULL_DAYS = 8;

type ClientSpec = (typeof CLIENTS)[number];

/**
 * Expands a head term into the long tail around it. Search Console exports are
 * dominated by these — the head term is a small fraction of total queries.
 */
function tailVariants(head: string): string[] {
  return [
    head,
    `best ${head}`,
    `${head} uk`,
    `${head} near me`,
    `cheap ${head}`,
    `${head} reviews`,
  ];
}

/**
 * Query-level metrics, distributed from the page totals rather than generated
 * independently.
 *
 * This matters more than it looks. A report that reads "8,732 clicks" from the
 * page table while the branded/non-branded split sums to something else is
 * visibly broken, and the whole point of the split is that it reconciles to the
 * headline. Deriving guarantees it.
 */
function buildQueryMetrics(
  c: ClientSpec,
  clientId: string,
  pageRows: (typeof schema.pageMetrics.$inferInsert)[],
  cutoff: string,
  rand: () => number,
): (typeof schema.queryMetrics.$inferInsert)[] {
  // Collapse page rows into per-day site totals.
  const daily = new Map<string, { clicks: number; impressions: number }>();
  for (const r of pageRows) {
    const t = daily.get(r.date as string) ?? { clicks: 0, impressions: 0 };
    t.clicks += r.clicks ?? 0;
    t.impressions += r.impressions ?? 0;
    daily.set(r.date as string, t);
  }

  // Head terms plus the long tail they actually rank for. A real Search Console
  // export is mostly tail; a demo with a dozen queries makes "top queries" and
  // "biggest movers" look trivially small and hides how the UI behaves at scale.
  const heads = [...new Set(c.pages.map((p) => p[2]))];
  const nonBrand = [...new Set(heads.flatMap(tailVariants))];
  const brand = [...c.brandQueries];

  const pressuredHeads = new Set<string>(c.aiPressured);
  // Pressure applies to a head term and everything in its tail — an AI Overview
  // sits on the topic, not on one exact phrasing.
  const isPressured = (term: string) =>
    [...pressuredHeads].some((h) => term === h || term.includes(h));

  // Zipf-ish weights: a handful of queries carry most of the traffic, which is
  // what a real Search Console export looks like.
  const weightsFor = (terms: string[]) =>
    terms.map((_, i) => 1 / Math.pow(i + 1, 0.9));
  const brandW = weightsFor(brand);
  const nonBrandW = weightsFor(nonBrand);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const brandWSum = sum(brandW);
  const nonBrandWSum = sum(nonBrandW);

  const rows: (typeof schema.queryMetrics.$inferInsert)[] = [];

  for (const [date, totals] of daily) {
    if (totals.impressions <= 0) continue;
    const daysBack = Math.round(
      (new Date(`${cutoff}T00:00:00Z`).getTime() -
        new Date(`${date}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    const pressure =
      daysBack >= AI_PRESSURE_ONSET_DAYS
        ? 0
        : Math.min(
            1,
            (AI_PRESSURE_ONSET_DAYS - daysBack) /
              (AI_PRESSURE_ONSET_DAYS - AI_PRESSURE_FULL_DAYS),
          );

    const emit = (
      terms: string[],
      weights: number[],
      wSum: number,
      share: number,
      branded: boolean,
    ) => {
      terms.forEach((term, i) => {
        const w = (weights[i] / wSum) * share;
        const jitter = 0.85 + rand() * 0.3;

        const impressions = Math.round(totals.impressions * w * jitter);
        let clicks = Math.round(totals.clicks * w * jitter);

        if (!branded && isPressured(term) && pressure > 0) {
          // The signature is impressions *holding* while clicks fall — so cut
          // clicks and leave impressions alone. Inflating impressions instead
          // would push the query totals above the page totals, which cannot
          // happen in real GSC data.
          clicks = Math.round(clicks * (1 - 0.55 * pressure));
        }

        if (impressions <= 0) return;
        clicks = Math.min(clicks, impressions);

        const ctr = clicks / impressions;
        // Invert the CTR curve used for pages to get a plausible position.
        const position = branded
          ? 1.1 + rand() * 0.8
          : Math.min(60, Math.max(1.5, Math.pow(ctr / 0.28, -1 / 1.1)));

        rows.push({
          clientId,
          date,
          query: term,
          clicks,
          impressions,
          ctr,
          position: Math.round(position * 10) / 10,
        });
      });
    };

    emit(brand, brandW, brandWSum, c.brandShare, true);
    emit(nonBrand, nonBrandW, nonBrandWSum, 1 - c.brandShare, false);
  }

  return rows;
}

async function main() {
  const db = await getDb();
  const cutoff = dataCutoff();

  console.log("Clearing existing data…");
  await db.delete(schema.pageMetrics);
  await db.delete(schema.queryMetrics);
  await db.delete(schema.clientState);
  await db.delete(schema.reports);
  await db.delete(schema.audits);
  await db.delete(schema.users);
  await db.delete(schema.pages);
  await db.delete(schema.clients);

  for (const c of CLIENTS) {
    const rand = rng(c.seed);

    const [client] = await db
      .insert(schema.clients)
      .values({
        name: c.name,
        domain: c.domain,
        gscProperty: c.gscProperty,
        ga4PropertyId: c.ga4PropertyId,
        branding: c.branding,
        // Derived terms plus the hand-written variants a human would add after
        // seeing what people actually type.
        brandTerms: [
          ...new Set([
            ...deriveBrandTerms(c.name, c.domain),
            ...c.brandQueries,
          ]),
        ],
        // Pretend last night's cron succeeded.
        lastSyncedAt: new Date(),
      })
      .returning();

    await db.insert(schema.clientState).values({
      clientId: client.id,
      notes: `Seeded demo client. Mirrors clients/${c.domain.split(".")[0]}.md.`,
      openFindings: [],
    });

    const metricRows: (typeof schema.pageMetrics.$inferInsert)[] = [];

    for (const [type, title, keyword, path, archetype] of c.pages) {
      // Spread publish dates across the history so milestones land at
      // different stages — some pages have a Month 6 number, some don't.
      const age = 25 + Math.floor(rand() * (HISTORY_DAYS - 40));
      const publishedAt = addDays(cutoff, -age);

      const [page] = await db
        .insert(schema.pages)
        .values({
          clientId: client.id,
          url: `https://${c.domain}${path}`,
          type,
          title,
          targetKeyword: keyword,
          publishedAt,
          status: "live",
        })
        .returning();

      const peak = ARCHETYPE_PEAK[archetype as Archetype];

      for (let d = 0; d <= age; d++) {
        const date = addDays(publishedAt, d);
        const m = maturity(archetype as Archetype, d);
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        // B2C leisure dips midweek, legal/B2B dips at weekends. Close enough:
        // weekends are quieter for everything here.
        const seasonal = weekday === 0 || weekday === 6 ? 0.62 : 1;
        const noise = 0.75 + rand() * 0.5;

        const impressions = Math.round(peak * 14 * m * seasonal * noise);
        if (impressions <= 0) continue;

        const position = positionFor(archetype as Archetype, m);
        // Organic CTR by position follows a power law, not an exponential:
        // ~28% at #1, ~2.3% at #10, ~0.5% at #40. An exponential decays to
        // nothing past position 20 and makes every young page look dead.
        const ctr = Math.max(0.002, 0.28 * Math.pow(position, -1.1));
        const clicks = Math.round(impressions * ctr * (0.8 + rand() * 0.4));

        metricRows.push({
          pageId: page.id,
          date,
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: Math.round(position * 10) / 10,
        });
      }
    }

    // Chunked so a single statement never gets absurdly large.
    for (let i = 0; i < metricRows.length; i += 500) {
      await db.insert(schema.pageMetrics).values(metricRows.slice(i, i + 500));
    }

    const queryRows = buildQueryMetrics(c, client.id, metricRows, cutoff, rand);
    for (let i = 0; i < queryRows.length; i += 500) {
      await db.insert(schema.queryMetrics).values(queryRows.slice(i, i + 500));
    }

    console.log(
      `  ${c.name}: ${c.pages.length} pages, ${metricRows.length} page rows, ` +
        `${queryRows.length} query rows`,
    );
  }

  await db.insert(schema.users).values([
    { email: "ai.harrysingh@gmail.com", role: "admin" },
    { email: "seo@agency.test", role: "seo" },
  ]);

  await seedReports(db);

  console.log(`\nSeeded. Data cutoff is ${cutoff} (today ${toIsoDate(new Date())}).`);
  process.exit(0);
}

/**
 * Real reports for every client, produced by the same rule engine the app uses.
 *
 * Possible because generation is deterministic and needs no API key — the seed
 * runs the production path rather than faking its output, so what a developer
 * sees locally is exactly what the tool produces.
 */
async function seedReports(db: Awaited<ReturnType<typeof getDb>>) {
  if (!referencesConfigured()) {
    console.log(
      "  Skipped reports — SEO_REFERENCES_DIR is not set, and the app will not " +
        "generate from SEO facts that carry no date.",
    );
    return;
  }

  const clients = await db.select().from(schema.clients);
  let made = 0;
  for (const c of clients) {
    for (const cadence of ["weekly", "monthly"] as const) {
      try {
        await generateReportForClient({ clientId: c.id, cadence });
        made++;
      } catch (err) {
        console.log(
          `  Could not generate the ${cadence} report for ${c.name}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }
  console.log(`  Generated ${made} reports.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
