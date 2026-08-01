import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { GscConfigError, isGscConfigured, syncClient } from "@/lib/gsc";

export const dynamic = "force-dynamic";

/** Manual "sync now" from the client screen. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  if (!isGscConfigured()) {
    return NextResponse.json(
      {
        error:
          "Search Console is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL " +
          "and GOOGLE_PRIVATE_KEY, then grant that service account read access " +
          "to the property.",
      },
      { status: 501 },
    );
  }

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
