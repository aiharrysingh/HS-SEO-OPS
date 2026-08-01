/**
 * Google sign-in for the team, separate from the service-account credentials
 * `gsc.ts` uses for the nightly pull. This is a person's own OAuth grant —
 * used to identify them and to list the Search Console properties their
 * Google account has access to.
 */

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export class GoogleOAuthConfigError extends Error {}

function config() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthConfigError(
      "Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

async function newClient() {
  const { google } = await import("googleapis");
  const { clientId, clientSecret, redirectUri } = config();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function authorizationUrl(state: string): Promise<string> {
  const client = await newClient();
  return client.generateAuthUrl({
    access_type: "offline",
    // Forces Google to hand back a refresh_token even on a repeat sign-in —
    // without it, only the very first consent ever includes one.
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
};

export async function exchangeCode(code: string): Promise<GoogleProfile> {
  const { google } = await import("googleapis");
  const client = await newClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    throw new Error("Google did not return an account id and email.");
  }

  return {
    sub: data.id,
    email: data.email,
    name: data.name ?? null,
    picture: data.picture ?? null,
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
  };
}

/**
 * An OAuth2 client seeded with a stored grant, for calling Google APIs (just
 * Search Console today) as that person. `googleapis` refreshes the access
 * token transparently when it's expired, given the refresh token.
 */
export async function clientFromStoredTokens(tokens: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}) {
  const client = await newClient();
  client.setCredentials({
    access_token: tokens.accessToken ?? undefined,
    refresh_token: tokens.refreshToken ?? undefined,
    expiry_date: tokens.expiresAt ? tokens.expiresAt.getTime() : undefined,
  });
  return client;
}
