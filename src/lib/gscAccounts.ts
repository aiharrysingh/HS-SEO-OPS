import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clientFromStoredTokens } from "./googleOAuth";

export type GscSite = { siteUrl: string; permissionLevel: string };

export class NoGoogleTokenError extends Error {}

/**
 * The Search Console properties this signed-in Google account can see —
 * their own OAuth grant, not the service account `gsc.ts` uses for syncing.
 */
export async function listGscPropertiesForUser(userId: string): Promise<GscSite[]> {
  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user || !user.refreshToken) {
    throw new NoGoogleTokenError(
      "No Search Console access on file for this account. Sign out and sign " +
        "back in, and approve access when Google asks.",
    );
  }

  const auth = await clientFromStoredTokens({
    accessToken: user.accessToken,
    refreshToken: user.refreshToken,
    expiresAt: user.tokenExpiresAt,
  });

  // Persist whatever the client refreshes to, so the stored copy doesn't go
  // stale sync after sync — googleapis only refreshes in memory otherwise.
  auth.on("tokens", (t) => {
    const update: Partial<typeof schema.users.$inferInsert> = {};
    if (t.access_token) update.accessToken = t.access_token;
    if (t.refresh_token) update.refreshToken = t.refresh_token;
    if (t.expiry_date) update.tokenExpiresAt = new Date(t.expiry_date);
    if (Object.keys(update).length > 0) {
      void db.update(schema.users).set(update).where(eq(schema.users.id, userId));
    }
  });

  const { google } = await import("googleapis");
  const searchconsole = google.searchconsole({ version: "v1", auth });
  const { data } = await searchconsole.sites.list();

  return (data.siteEntry ?? [])
    .map((s) => ({
      siteUrl: s.siteUrl ?? "",
      permissionLevel: s.permissionLevel ?? "unknown",
    }))
    .filter((s) => s.siteUrl);
}
