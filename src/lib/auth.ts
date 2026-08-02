import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COOKIE_NAME, decodeSession } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  role: schema.UserRole;
  name: string | null;
  picture: string | null;
  clientId: string | null;
};

export class AuthError extends Error {}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const session = decodeSession(jar.get(COOKIE_NAME)?.value);
  if (!session) return null;

  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    picture: user.picture,
    clientId: user.clientId,
  };
}

/** Throws rather than returning null — for API routes that must not run unauthenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Sign in required.");
  return user;
}

/**
 * For route handlers: `const blocked = await authGuard(); if (blocked) return blocked;`
 * Proxy already keeps a cookie-less request from reaching here in the normal
 * case — this is the check that actually matters, per Next 16's own guidance
 * that Proxy isn't a substitute for it.
 *
 * **Client accounts are rejected here too.** Every route using this guard is a
 * team operation — syncing, generating reports, editing pages, running audits.
 * A client holds a perfectly valid session, so checking only "is signed in"
 * would let them drive another client's data. Read access for clients goes
 * through `clientPortal.ts`, which scopes every query to their own id.
 */
export async function authGuard(): Promise<NextResponse | null> {
  const { blocked } = await requireTeamUser();
  return blocked;
}

/**
 * `authGuard` for routes that also need the user object.
 *
 * Returns the team user, or the response to send back. Same rejection rules as
 * `authGuard` — the two must not drift, which is why one calls the other.
 */
export async function requireTeamUser(): Promise<
  { user: CurrentUser; blocked: null } | { user: null; blocked: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      blocked: NextResponse.json({ error: "Sign in required." }, { status: 401 }),
    };
  }
  if (user.role === "client") {
    return {
      user: null,
      blocked: NextResponse.json({ error: "Not permitted." }, { status: 403 }),
    };
  }
  return { user, blocked: null };
}
