import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { GscConfigError, importPagesFromGsc } from "@/lib/gsc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Create tracked `pages` rows from the URLs Search Console already reports. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  let minImpressions = 1;
  try {
    const body = await req.json();
    if (typeof body?.minImpressions === "number" && body.minImpressions >= 0) {
      minImpressions = body.minImpressions;
    }
  } catch {
    // No body is fine — the default imports everything GSC returns.
  }

  try {
    const result = await importPagesFromGsc(clientId, { minImpressions });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GscConfigError ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
