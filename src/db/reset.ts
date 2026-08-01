/**
 * Drops every table and the migration bookkeeping, so `npm run db:migrate`
 * starts from nothing. Local convenience only.
 */
import "./env";

async function main() {
  const url = process.env.DATABASE_URL;
  const sql = `
    drop schema if exists drizzle cascade;
    drop table if exists page_metrics, client_state, reports, audits, users, pages, clients cascade;
  `;

  if (url) {
    if (process.env.ALLOW_REMOTE_RESET !== "yes") {
      console.error(
        "DATABASE_URL is set. Refusing to drop a remote database.\n" +
          "Re-run with ALLOW_REMOTE_RESET=yes if you really mean it.",
      );
      process.exit(1);
    }
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { max: 1 });
    await client.unsafe(sql);
    await client.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = new PGlite(process.env.PGLITE_PATH ?? ".pglite");
    await client.exec(sql);
    await client.close();
  }
  console.log("Dropped. Run `npm run setup` to rebuild.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
