import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { GscConfigError, syncClient } from "@/lib/gsc";

export const dynamic = "force-dynamic";

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
    const status = err instanceof GscConfigError ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
