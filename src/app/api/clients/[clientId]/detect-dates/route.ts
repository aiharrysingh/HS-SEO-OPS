import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { detectPublishDatesForClient } from "@/lib/publishDates";

export const dynamic = "force-dynamic";
// Fetches a few hundred pages from the client's own site; give it room.
export const maxDuration = 300;

/** Fill in publish dates from what each page states about itself. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  let limit = 300;
  try {
    const body = await req.json();
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, 500);
    }
  } catch {
    // No body is fine.
  }

  try {
    const result = await detectPublishDatesForClient(clientId, { limit });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
