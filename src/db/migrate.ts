/**
 * Applies the generated SQL in ./drizzle to whichever database is configured.
 * Run with `npm run db:migrate`.
 */
import "dotenv/config";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = "./drizzle";

async function main() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, { migrate }, { default: postgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("drizzle-orm/postgres-js/migrator"),
      import("postgres"),
    ]);
    // A migration connection must not be pooled or prepared.
    const client = postgres(url, { max: 1 });
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    await client.end();
    console.log("Migrated Postgres at", new URL(url).host);
    return;
  }

  const [{ drizzle }, { migrate }, { PGlite }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@electric-sql/pglite"),
  ]);
  const path = process.env.PGLITE_PATH ?? ".pglite";
  const client = new PGlite(path);
  await migrate(drizzle(client, { schema }), {
    migrationsFolder: MIGRATIONS_FOLDER,
  });
  await client.close();
  console.log(`Migrated embedded Postgres at ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
