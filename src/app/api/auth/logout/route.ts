import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(COOKIE_NAME);
  return res;
}
