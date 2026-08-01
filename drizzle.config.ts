import { defineConfig } from "drizzle-kit";

/**
 * Used only to *generate* SQL from src/db/schema.ts. Applying migrations goes
 * through `npm run db:migrate`, which picks the driver the same way the app
 * does (Postgres if DATABASE_URL is set, otherwise embedded PGlite).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/hs_seo_ops",
  },
  strict: true,
  verbose: true,
});
