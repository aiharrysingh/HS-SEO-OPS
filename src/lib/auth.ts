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
 */
export async function authGuard(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (user) return null;
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}
