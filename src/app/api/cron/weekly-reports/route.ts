import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { referencesConfigured } from "@/lib/references";
import { generateReportForClient } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled draft generation for every client.
 *
 * Schedule this *after* the nightly GSC pull. Generating a report before the
 * night's data has landed produces a confident report about a period the
 * database doesn't have yet.
 *
 * Pass `?cadence=monthly` for the monthly run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set; refusing to run." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!referencesConfigured()) {
    return NextResponse.json(
      {
        error:
          "SEO_REFERENCES_DIR is not set, so the dated SEO facts cannot be " +
          "loaded and reports will not be generated from stale built-in ones.",
      },
      { status: 501 },
    );
  }

  const cadence =
    new URL(req.url).searchParams.get("cadence") === "monthly"
      ? "monthly"
      : "weekly";

  const db = await getDb();
  const clients = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));

  const generated: { clientId: string; name: string; reportId: string }[] = [];
  const failures: { clientId: string; name: string; error: string }[] = [];

  // Sequential: generation is cheap now, but the queries behind it are not,
  // and a nightly job has no reason to hammer the database in parallel.
  for (const c of clients) {
    try {
      const { reportId } = await generateReportForClient({
        clientId: c.id,
        cadence,
      });
      generated.push({ clientId: c.id, name: c.name, reportId });
    } catch (err) {
      failures.push({
        clientId: c.id,
        name: c.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(
    { cadence, generated: generated.length, failed: failures.length, generated_reports: generated, failures },
    // A partial failure must not read as success to whatever is watching.
    { status: failures.length > 0 ? 207 : 200 },
  );
}
