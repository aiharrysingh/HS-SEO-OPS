import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { GoogleOAuthConfigError, authorizationUrl } from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "hs_oauth_state";

/** Start Google sign-in: redirect to consent, with a CSRF state cookie. */
export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const next = reqUrl.searchParams.get("next");
  // Only ever a same-app relative path, never an external redirect target.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  const csrf = randomBytes(24).toString("base64url");
  const state = safeNext ? `${csrf}|${safeNext}` : csrf;

  let url: string;
  try {
    url = await authorizationUrl(state);
  } catch (err) {
    const message = err instanceof GoogleOAuthConfigError
      ? err.message
      : "Could not start Google sign-in.";
    const dest = new URL("/login", req.url);
    dest.searchParams.set("error", message);
    return NextResponse.redirect(dest);
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
