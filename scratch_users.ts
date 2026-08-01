import "./src/db/env";
import { getDb, schema } from "./src/db";

async function main() {
  const db = await getDb();
  const rows = await db.select({
    id: schema.users.id,
    email: schema.users.email,
    role: schema.users.role,
    googleSub: schema.users.googleSub,
    createdAt: schema.users.createdAt,
  }).from(schema.users);
  console.log(JSON.stringify(rows, null, 2));
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
