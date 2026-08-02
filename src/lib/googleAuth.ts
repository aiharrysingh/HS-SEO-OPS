import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clientFromStoredTokens } from "./googleOAuth";

/**
 * Picking the credential to call a Google API with, shared by Search Console
 * and GA4.
 *
 * Two paths, in order:
 *  1. A team member's own OAuth grant, recorded on the client when they linked
 *     the property from `/account`. No extra setup — if they can see it there,
 *     this can read it.
 *  2. The shared service account, which has to be granted access to each
 *     property by hand but doesn't depend on one person's login surviving.
 *
 * The scope only matters for the service-account branch: a JWT is minted for
 * exactly the scopes asked for, whereas an OAuth grant already carries
 * whatever the user consented to at sign-in.
 */

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export class GoogleAuthError extends Error {}

/**
 * Bounds a single Google API call, including the token refresh gaxios makes
 * implicitly on the first call.
 *
 * Without this a stalled connection hangs indefinitely with no error, which is
 * far more expensive to diagnose than a clean timeout — and, for the Search
 * Console sync, leaves `syncStartedAt` claimed until it goes stale.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export async function resolveGoogleAuth(
  {
    authUserId,
    scope,
  }: {
    /** Whose stored OAuth grant to try first; null to go straight to the service account. */
    authUserId: string | null;
    scope: string;
  },
  onMissing: () => never,
) {
  if (authUserId) {
    const db = await getDb();
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, authUserId))
      .limit(1);

    if (user?.refreshToken) {
      const userId = user.id;
      const auth = await clientFromStoredTokens({
        accessToken: user.accessToken,
        refreshToken: user.refreshToken,
        expiresAt: user.tokenExpiresAt,
      });
      // googleapis refreshes in memory only; persist it or the stored copy
      // goes stale and every later call pays for a fresh refresh.
      auth.on("tokens", (t) => {
        const update: Partial<typeof schema.users.$inferInsert> = {};
        if (t.access_token) update.accessToken = t.access_token;
        if (t.refresh_token) update.refreshToken = t.refresh_token;
        if (t.expiry_date) update.tokenExpiresAt = new Date(t.expiry_date);
        if (Object.keys(update).length > 0) {
          void db
            .update(schema.users)
            .set(update)
            .where(eq(schema.users.id, userId));
        }
      });
      return auth;
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private keys carry literal \n when they come from an env var.
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (email && key) {
    const { google } = await import("googleapis");
    return new google.auth.JWT({ email, key, scopes: [scope] });
  }

  onMissing();
}
