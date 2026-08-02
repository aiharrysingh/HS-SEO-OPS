import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Link a GA4 property (discovered via the signed-in Google account) to a client. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { clientId } = await params;

  let body: { ga4PropertyId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const property = body.ga4PropertyId?.trim() || null;

  const db = await getDb();
  const [row] = await db
    .update(schema.clients)
    .set({
      ga4PropertyId: property,
      // This person can see the property on /account because their Google
      // account can read it — use that same grant to query it.
      ga4AuthUserId: property ? user.id : null,
    })
    .where(eq(schema.clients.id, clientId))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "No such client." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, client: row });
}
