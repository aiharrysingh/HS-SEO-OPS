import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isGoogleOAuthConfigured } from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { error, next } = await searchParams;
  const configured = isGoogleOAuthConfigured();

  const startUrl = next
    ? `/api/auth/google?next=${encodeURIComponent(next)}`
    : "/api/auth/google";

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-6">
        <h1 className="text-lg font-semibold text-ink">HS SEO Ops</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Sign in with the Google account your team uses for Search Console.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-wash-critical px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}

        {configured ? (
          <a
            href={startUrl}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-page px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-wash-1"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        ) : (
          <p className="mt-5 rounded-lg bg-wash-warning px-3 py-2 text-xs leading-snug text-ink-secondary">
            Google sign-in isn&apos;t configured yet. Set{" "}
            <code className="font-mono">GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
            <code className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</code> and{" "}
            <code className="font-mono">GOOGLE_OAUTH_REDIRECT_URI</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C33.9 5.1 29.2 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.8-.4-4.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.8 1.1 8 3l6-6C33.9 5.1 29.2 3 24 3c-7.7 0-14.4 4.4-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.5 26.7 37.5 24 37.5c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.5 40.5 16.2 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2C40.5 36 44 30.5 44 24c0-1.4-.1-2.8-.4-3.5z"
      />
    </svg>
  );
}
