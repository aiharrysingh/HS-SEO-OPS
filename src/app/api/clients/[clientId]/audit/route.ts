import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { runAndStoreAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
// Fetches robots.txt, the sitemap, a page sample and PageSpeed Insights.
export const maxDuration = 300;

/** Run an audit for a client and store it, so audits are comparable over time. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  try {
    const { auditId, result } = await runAndStoreAudit(clientId);
    return NextResponse.json({
      ok: true,
      auditId,
      findings: result.findings.length,
      pagesSampled: result.pagesSampled,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
