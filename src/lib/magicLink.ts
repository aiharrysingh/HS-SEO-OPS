import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Magic-link tokens for client sign-in (plan §7: "magic link for clients").
 *
 * Same HMAC construction as the session cookie and no new dependency, but a
 * deliberately separate secret domain (the payload carries its own purpose
 * tag) so a session cookie can never be replayed as a login token or the
 * reverse.
 *
 * **Email delivery is not wired up.** There is no mail provider configured, so
 * the link is generated and handed to a team member to send however they
 * already talk to the client. That is a real limitation, stated rather than
 * papered over with a half-working SMTP path.
 */

const PURPOSE = "client-magic-link";

/**
 * Long enough to survive an email sitting unread over a weekend, short enough
 * that a forwarded link doesn't stay live indefinitely.
 */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

export type MagicPayload = {
  purpose: typeof PURPOSE;
  userId: string;
  iat: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error("SESSION_SECRET is not set; cannot issue client links.");
  }
  return s;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function createMagicToken(userId: string): string {
  const payload: MagicPayload = { purpose: PURPOSE, userId, iat: Date.now() };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readMagicToken(token: string | undefined | null): MagicPayload | null {
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
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as MagicPayload;
    // The purpose tag is what stops a session cookie being replayed here.
    if (payload.purpose !== PURPOSE) return null;
    if (Date.now() - payload.iat > MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export const MAGIC_LINK_DAYS = MAX_AGE_MS / (1000 * 60 * 60 * 24);
