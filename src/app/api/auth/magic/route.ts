import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { readMagicToken } from "@/lib/magicLink";
import { COOKIE_NAME, SESSION_MAX_AGE_SECONDS, encodeSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Consumes a client magic link and establishes a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const payload = readMagicToken(url.searchParams.get("token"));

  const fail = (message: string) => {
    const dest = new URL("/portal/login", req.url);
    dest.searchParams.set("error", message);
    return NextResponse.redirect(dest);
  };

  if (!payload) {
    return fail("That link is invalid or has expired. Ask for a new one.");
  }

  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payload.userId))
    .limit(1);

  // Re-checked at redemption rather than trusted from the token: a role or
  // client change since the link was issued must take effect immediately.
  if (!user || user.role !== "client" || !user.clientId) {
    return fail("This link is no longer valid for that account.");
  }

  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));

  const res = NextResponse.redirect(new URL("/portal", req.url));
  res.cookies.set(
    COOKIE_NAME,
    encodeSession({ userId: user.id, email: user.email, role: user.role }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );
  return res;
}
