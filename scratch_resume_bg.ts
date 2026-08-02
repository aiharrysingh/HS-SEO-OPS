import "./src/db/env";
import { getDb, schema } from "./src/db";
import { syncClient } from "./src/lib/gsc";

async function main() {
  const db = await getDb();
  // Clear the claim left by the killed process so the resume isn't rejected.
  await db.update(schema.clients).set({ syncStartedAt: null });
  const clients = await db.select().from(schema.clients);
  for (const c of clients) {
    if (!c.gscProperty) continue;
    const t0 = Date.now();
    try {
      const r = await syncClient(c.id);
      console.log(`DONE ${c.name}: ${r.start}..${r.end} pages=${r.rowsStored} queries=${r.queryRowsStored} countries=${r.countryRowsStored} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
    } catch (e) {
      console.log(`FAILED ${c.name}: ${String((e as Error).message).slice(0,160)}`);
    }
  }
  console.log("ALL DONE");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", String(e.message).slice(0,200)); process.exit(1); });
