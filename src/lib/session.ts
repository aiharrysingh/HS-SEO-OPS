import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed session cookie — HMAC-SHA256 over a JSON payload, no external
 * dependency. Not encrypted: don't put anything in here that would matter if
 * read, only if forged. Forging is what the signature stops.
 */

export const COOKIE_NAME = "hs_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export type SessionPayload = {
  userId: string;
  email: string;
  role: string;
  iat: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error(
      "SESSION_SECRET is not set. Generate a long random string and set it before signing in.",
    );
  }
  return s;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function encodeSession(data: Omit<SessionPayload, "iat">): string {
  const body = Buffer.from(
    JSON.stringify({ ...data, iat: Date.now() }),
    "utf8",
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (Date.now() - payload.iat > MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;
