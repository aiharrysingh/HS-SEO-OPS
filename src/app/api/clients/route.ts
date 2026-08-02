import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireTeamUser } from "@/lib/auth";
import { deriveBrandTerms } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Create a client, typically from a Search Console property picked on /account. */
export async function POST(req: Request) {
  const { user, blocked } = await requireTeamUser();
  if (blocked) return blocked;

  let body: { name?: string; domain?: string; gscProperty?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const domain = body.domain?.trim();
  if (!name || !domain) {
    return NextResponse.json({ error: "name and domain are required." }, { status: 400 });
  }

  const gscProperty = body.gscProperty?.trim() || null;

  const db = await getDb();
  const [row] = await db
    .insert(schema.clients)
    .values({
      name,
      domain,
      gscProperty,
      // Whoever picked this property on /account has read access to it —
      // that's how it got listed — so their Google sign-in can sync it.
      gscAuthUserId: gscProperty ? user.id : null,
      brandTerms: deriveBrandTerms(name, domain),
    })
    .returning();

  return NextResponse.json({ ok: true, client: row }, { status: 201 });
}
