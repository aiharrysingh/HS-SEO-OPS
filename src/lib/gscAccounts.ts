import { GSC_SCOPE, resolveGoogleAuth } from "./googleAuth";

export type GscSite = { siteUrl: string; permissionLevel: string };

export class NoGoogleTokenError extends Error {}

/**
 * The Search Console properties this signed-in Google account can see —
 * their own OAuth grant, not the service account `gsc.ts` uses for syncing.
 */
export async function listGscPropertiesForUser(userId: string): Promise<GscSite[]> {
  const auth = await resolveGoogleAuth(
    { authUserId: userId, scope: GSC_SCOPE },
    () => {
      throw new NoGoogleTokenError(
        "No Search Console access on file for this account. Sign out and sign " +
          "back in, and approve access when Google asks.",
      );
    },
  );

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
