import "./src/db/env";
import { getDb, schema } from "./src/db";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const email = "harmeet.singh@signitysolutions.com";
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) {
    console.log("already exists", existing.id, existing.role);
    return;
  }
  const [row] = await db.insert(schema.users).values({ email, role: "admin" }).returning();
  console.log("inserted", row.id, row.email, row.role);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
