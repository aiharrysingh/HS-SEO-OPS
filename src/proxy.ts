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
  "/api/auth",
  "/api/cron",
  // The client-facing branded export. No client-auth system exists yet
  // (plan defers it to magic-link) — unauthenticated on purpose, unchanged
  // from before this login system existed.
  "/reports",
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
  dest.pathname = "/login";
  dest.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(dest);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
