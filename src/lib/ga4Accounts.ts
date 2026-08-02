import { GA4_SCOPE, resolveGoogleAuth } from "./googleAuth";
import { NoGoogleTokenError } from "./gscAccounts";

export type Ga4Property = {
  /** "properties/123456789" — the form the Data API wants. */
  name: string;
  displayName: string;
  account: string;
};

/**
 * The GA4 properties this signed-in Google account can see.
 *
 * `accountSummaries.list` rather than `properties.list` because the latter
 * requires an account filter — summaries return everything the caller can
 * reach in one call, which is exactly what a picker needs.
 */
export async function listGa4PropertiesForUser(
  userId: string,
): Promise<Ga4Property[]> {
  const auth = await resolveGoogleAuth(
    { authUserId: userId, scope: GA4_SCOPE },
    () => {
      throw new NoGoogleTokenError(
        "No Google Analytics access on file for this account. Sign out and " +
          "sign back in, and approve Analytics access when Google asks.",
      );
    },
  );

  const { google } = await import("googleapis");
  const admin = google.analyticsadmin({ version: "v1beta", auth });

  const out: Ga4Property[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await admin.accountSummaries.list({
      pageSize: 200,
      pageToken,
    });
    for (const account of data.accountSummaries ?? []) {
      for (const p of account.propertySummaries ?? []) {
        if (!p.property) continue;
        out.push({
          name: p.property,
          displayName: p.displayName ?? p.property,
          account: account.displayName ?? "",
        });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
