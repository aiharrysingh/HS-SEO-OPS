import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Two drivers, one API.
 *
 * - `DATABASE_URL` set  -> real Postgres (Neon, Supabase, anything).
 * - `DATABASE_URL` unset -> PGlite, an embedded Postgres that writes to
 *   `.pglite/` in the repo. Same SQL, same migrations, no account to create.
 *
 * The plan calls for Postgres and this is Postgres either way; the only thing
 * that changes between local and hosted is the connection string.
 *
 * The PGlite handle is cast to the postgres-js database type. The two drizzle
 * dialects expose an identical query API, and keeping a single `Db` type stops
 * every call site from having to branch.
 */
async function create(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, { default: postgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
    ]);
    // Serverless hosts open a connection per invocation; keep the pool at 1
    // there and let a long-running process use a real pool.
    const client = postgres(url, {
      max: process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? 1 : 10,
      prepare: false,
    });
    return drizzle(client, { schema });
  }

  const [{ drizzle }, { PGlite }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
  ]);
  const client = new PGlite(process.env.PGLITE_PATH ?? ".pglite");
  return drizzle(client, { schema }) as unknown as Db;
}

// Reuse across hot reloads in dev; PGlite in particular holds an exclusive
// lock on its data directory, so a second instance would fail to open.
const globalForDb = globalThis as unknown as { __dbPromise?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__dbPromise ??= create();
  return globalForDb.__dbPromise;
}

export const usingEmbeddedPostgres = () => !process.env.DATABASE_URL;

export { schema };
