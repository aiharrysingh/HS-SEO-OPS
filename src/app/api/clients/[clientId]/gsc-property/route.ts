import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Link a Search Console property (discovered via the signed-in Google account) to a client. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { clientId } = await params;

  let body: { gscProperty?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body.gscProperty) {
    return NextResponse.json({ error: "gscProperty is required." }, { status: 400 });
  }

  const db = await getDb();
  const [row] = await db
    .update(schema.clients)
    .set({
      gscProperty: body.gscProperty,
      // This person can see the property on /account because their Google
      // account has read access to it — use that same grant to sync it.
      gscAuthUserId: user.id,
    })
    .where(eq(schema.clients.id, clientId))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "No such client." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, client: row });
}
