import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { MAGIC_LINK_DAYS, createMagicToken } from "@/lib/magicLink";

export const dynamic = "force-dynamic";

/**
 * Creates (or refreshes) a client login and returns a shareable link.
 *
 * There is no mail provider wired up, so the link is returned for a team
 * member to send however they already talk to the client. Honest about that
 * rather than shipping a half-working SMTP path that fails silently.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const actor = await getCurrentUser();
  if (!actor) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  // Client accounts must never mint access for anyone, including themselves.
  if (actor.role === "client") {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const { clientId } = await params;

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const db = await getDb();
  const [client] = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) {
    return NextResponse.json({ error: "No such client." }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let user: typeof schema.users.$inferSelect;

  if (existing) {
    // Refuse to convert a team account into a client one — that would silently
    // downgrade someone's access and hand the link to whoever asked.
    if (existing.role !== "client") {
      return NextResponse.json(
        { error: `${email} is already a team account.` },
        { status: 409 },
      );
    }
    if (existing.clientId && existing.clientId !== clientId) {
      return NextResponse.json(
        { error: `${email} already belongs to a different client.` },
        { status: 409 },
      );
    }
    [user] = await db
      .update(schema.users)
      .set({ clientId })
      .where(eq(schema.users.id, existing.id))
      .returning();
  } else {
    [user] = await db
      .insert(schema.users)
      .values({ email, role: "client", clientId })
      .returning();
  }

  const origin = new URL(req.url).origin;
  const link = `${origin}/api/auth/magic?token=${createMagicToken(user.id)}`;

  return NextResponse.json({
    ok: true,
    email: user.email,
    link,
    expiresInDays: MAGIC_LINK_DAYS,
  });
}

/** Existing client logins for this client, so the team can see who has access. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const actor = await getCurrentUser();
  if (!actor || actor.role === "client") {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const { clientId } = await params;
  const db = await getDb();
  const users = await db
    .select({ email: schema.users.email, lastLoginAt: schema.users.lastLoginAt })
    .from(schema.users)
    .where(
      and(eq(schema.users.clientId, clientId), eq(schema.users.role, "client")),
    );
  return NextResponse.json({ users });
}
