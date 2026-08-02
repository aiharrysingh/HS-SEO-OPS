import { NextResponse } from "next/server";
import { syncAllClients } from "@/lib/gsc";

export const dynamic = "force-dynamic";
// GSC pulls are slow-ish; give the whole portfolio room to finish.
export const maxDuration = 300;

/**
 * Nightly Search Console pull for every client with a property set.
 *
 * Point the host's scheduler at this (Vercel cron, a GitHub Action, systemd
 * timer — anything that can issue an authenticated GET). Run it after the GSC
 * lag window, not at midnight: there is no new settled data before then.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // Without a secret this endpoint would let anyone burn the day's GSC quota.
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set; refusing to run." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const startedAt = new Date();
  const { results, failures } = await syncAllClients();

  return NextResponse.json(
    {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      synced: results.length,
      failed: failures.length,
      results,
      failures,
    },
    // A partial failure must not read as success to whatever is watching.
    { status: failures.length > 0 ? 207 : 200 },
  );
}
