import { config } from "dotenv";

/**
 * Loads env the same way Next.js does, so a CLI script and the running app see
 * the same configuration.
 *
 * `dotenv/config` alone reads only `.env`, which meant `npm run db:seed` and
 * `npm run dev` disagreed about whether SEO_REFERENCES_DIR was set — the script
 * silently skipped work the app could do. Precedence matches Next: `.env.local`
 * wins, `.env` fills the gaps.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
