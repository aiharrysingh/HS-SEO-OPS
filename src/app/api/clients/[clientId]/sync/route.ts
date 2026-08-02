import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { GscConfigError, SyncInProgressError, syncClient } from "@/lib/gsc";

export const dynamic = "force-dynamic";
// A first sync backfills 480 days across two dimension pulls — give it room.
export const maxDuration = 300;

/**
 * Manual "sync now" from the client screen. Whether this client *can* sync
 * depends on that one client (its own linked Google account, or the shared
 * service account) — resolved inside `syncClient`, not checked up front here.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  try {
    const result = await syncClient(clientId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyncInProgressError) {
      return NextResponse.json(
        { error: err.message, startedAt: err.startedAt.toISOString() },
        { status: 409 },
      );
    }
    const status = err instanceof GscConfigError ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
