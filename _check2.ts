import "dotenv/config";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { trailingWindow } from "@/lib/dates";
import { brandMatcher } from "@/lib/brand";

async function main() {
  const db = await getDb();
  const w = trailingWindow(28);
  const clients = await db.select().from(schema.clients);

  console.log(`window ${w.start}..${w.end}\n`);

  for (const c of clients) {
    const [pageTot] = await db
      .select({
        clicks: sql<number>`coalesce(sum(${schema.pageMetrics.clicks}),0)::int`,
        impr: sql<number>`coalesce(sum(${schema.pageMetrics.impressions}),0)::int`,
      })
      .from(schema.pageMetrics)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageMetrics.pageId))
      .where(
        and(
          eq(schema.pages.clientId, c.id),
          gte(schema.pageMetrics.date, w.start),
          lte(schema.pageMetrics.date, w.end),
        ),
      );

    const qRows = await db
      .select({
        query: schema.queryMetrics.query,
        clicks: sql<number>`coalesce(sum(${schema.queryMetrics.clicks}),0)::int`,
        impr: sql<number>`coalesce(sum(${schema.queryMetrics.impressions}),0)::int`,
      })
      .from(schema.queryMetrics)
      .where(
        and(
          eq(schema.queryMetrics.clientId, c.id),
          gte(schema.queryMetrics.date, w.start),
          lte(schema.queryMetrics.date, w.end),
        ),
      )
      .groupBy(schema.queryMetrics.query);

    const m = brandMatcher(c.brandTerms);
    let bC = 0, bI = 0, nC = 0, nI = 0;
    for (const r of qRows) {
      if (m.isBranded(r.query)) { bC += Number(r.clicks); bI += Number(r.impr); }
      else { nC += Number(r.clicks); nI += Number(r.impr); }
    }
    const qC = bC + nC, qI = bI + nI;
    const drift = (a: number, b: number) => b === 0 ? "n/a" : `${(((a - b) / b) * 100).toFixed(1)}%`;

    console.log(`${c.name}`);
    console.log(`  brand terms: ${c.brandTerms.length} — ${c.brandTerms.slice(0, 4).join(", ")}…`);
    console.log(`  pages   clicks=${pageTot.clicks}  impr=${pageTot.impr}`);
    console.log(`  queries clicks=${qC}  impr=${qI}   drift vs pages: ${drift(qC, Number(pageTot.clicks))} clicks, ${drift(qI, Number(pageTot.impr))} impr`);
    console.log(`  branded     ${bC} clicks (${((bC / qC) * 100).toFixed(1)}%)`);
    console.log(`  non-branded ${nC} clicks (${((nC / qC) * 100).toFixed(1)}%)`);
    console.log(`  distinct queries in window: ${qRows.length}`);
    console.log();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
