import "./src/db/env";
import { getDb, schema } from "./src/db";
import { syncClient } from "./src/lib/gsc";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  // Force the full-backfill path: the resume mark reflects the old 90-day pull.
  await db.update(schema.clients).set({ lastSyncedAt: null, syncStartedAt: null });
  const clients = await db.select().from(schema.clients);
  for (const c of clients) {
    if (!c.gscProperty) { console.log(`skip ${c.name} (no property)`); continue; }
    const t0 = Date.now();
    try {
      const r = await syncClient(c.id);
      console.log(`${c.name}: ${r.start}..${r.end} pages=${r.rowsStored} queries=${r.queryRowsStored} countries=${r.countryRowsStored} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
    } catch (e) {
      console.log(`${c.name}: FAILED ${String((e as Error).message).slice(0,120)}`);
    }
  }
  const s = await db.execute(sql`
    select (select count(*) from page_metrics)::int pm,
           (select count(*) from query_metrics)::int qm,
           (select count(*) from country_metrics)::int cm,
           (select min(date)::text from page_metrics) as starts`);
  console.log("\ntotals:", JSON.stringify((s as unknown as {rows?:unknown[]}).rows?.[0] ?? s));
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", String(e.message).slice(0,200)); process.exit(1); });
