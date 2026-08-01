import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { exchangeCode } from "@/lib/googleOAuth";
import { COOKIE_NAME, SESSION_MAX_AGE_SECONDS, encodeSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "hs_oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const rawCookieState = req.headers
    .get("cookie")
    ?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  const cookieState = rawCookieState
    ? decodeURIComponent(rawCookieState)
    : undefined;

  const loginError = (message: string) => {
    const dest = new URL("/login", req.url);
    dest.searchParams.set("error", message);
    return NextResponse.redirect(dest);
  };

  if (!code || !state || !cookieState || state !== cookieState) {
    return loginError("Sign-in expired or was tampered with. Try again.");
  }

  const next = state.includes("|") ? state.slice(state.indexOf("|") + 1) : null;

  const profile = await exchangeCode(code).catch(() => null);
  if (!profile) {
    return loginError("Google sign-in failed. Try again.");
  }

  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, profile.email))
    .limit(1);

  let user: typeof schema.users.$inferSelect;

  if (!existing) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);

    // Team is provisioned by invite, not open sign-up — except the very
    // first login ever, which bootstraps the admin account.
    if (count > 0) {
      return loginError(
        "This Google account isn't on the team yet. Ask an admin to add it.",
      );
    }

    [user] = await db
      .insert(schema.users)
      .values({
        email: profile.email,
        role: "admin",
        googleSub: profile.sub,
        name: profile.name,
        picture: profile.picture,
        accessToken: profile.accessToken,
        refreshToken: profile.refreshToken,
        tokenExpiresAt: profile.expiryDate ? new Date(profile.expiryDate) : null,
        lastLoginAt: new Date(),
      })
      .returning();
  } else {
    if (existing.role === "client") {
      return loginError("This account signs in a different way — ask an admin.");
    }

    [user] = await db
      .update(schema.users)
      .set({
        googleSub: profile.sub,
        name: profile.name,
        picture: profile.picture,
        accessToken: profile.accessToken,
        // Google only returns a refresh_token on the consent screen, not
        // every repeat sign-in — keep the one already on file if this login
        // didn't get a new one.
        refreshToken: profile.refreshToken ?? existing.refreshToken,
        tokenExpiresAt: profile.expiryDate
          ? new Date(profile.expiryDate)
          : existing.tokenExpiresAt,
        lastLoginAt: new Date(),
      })
      .where(eq(schema.users.id, existing.id))
      .returning();
  }

  const res = NextResponse.redirect(new URL(next ?? "/", req.url));
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
  res.cookies.delete(STATE_COOKIE);
  return res;
}
