import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME } from "@/lib/session";

/**
 * Optimistic check only — Next 16 is explicit that Proxy "should not be used
 * as a full session management or authorization solution". This just avoids
 * rendering a page for a visitor with no session cookie at all; every screen
 * and mutation still checks for real in `@/lib/auth` (`getCurrentUser` /
 * `requireUser`), which is what actually enforces access.
 */
const PUBLIC_PREFIXES = [
  "/login",
  // Where a client lands with an expired or missing link.
  "/portal/login",
  // Includes the magic-link redemption endpoint, which must be reachable
  // precisely because the visitor has no session yet.
  "/api/auth",
  "/api/cron",
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (req.cookies.has(COOKIE_NAME)) {
    return NextResponse.next();
  }

  const dest = req.nextUrl.clone();
  // Send clients to their own sign-in rather than the team's Google one, which
  // they cannot use and which would look like the wrong door.
  dest.pathname = pathname.startsWith("/portal") ? "/portal/login" : "/login";
  dest.search = pathname.startsWith("/portal")
    ? ""
    : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(dest);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
