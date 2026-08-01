import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { ReferencesUnavailableError, referencesConfigured } from "@/lib/references";
import { generateReportForClient } from "@/lib/reports";

export const dynamic = "force-dynamic";

/** Generate (or regenerate) a draft report for a cadence. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  let cadence: "weekly" | "monthly" = "weekly";
  try {
    const body = await req.json();
    if (body?.cadence === "monthly") cadence = "monthly";
  } catch {
    // No body is fine — weekly is the default.
  }

  if (!referencesConfigured()) {
    return NextResponse.json(
      {
        error:
          "SEO_REFERENCES_DIR is not set. The app loads its SEO facts from the " +
          "shared skill files at runtime and will not fall back to hard-coded " +
          "ones. Point it at the unzipped skills folder and try again.",
      },
      { status: 501 },
    );
  }

  try {
    const result = await generateReportForClient({ clientId, cadence });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof ReferencesUnavailableError ? 501 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
