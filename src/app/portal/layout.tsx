import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalClient, requirePortalViewer } from "@/lib/clientPortal";

export const dynamic = "force-dynamic";

/**
 * The client-facing shell (plan §8): branded, read-only, deliberately thin.
 *
 * Everything below resolves its client from the session, never from the URL —
 * there is no client id in any portal path to tamper with.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects a signed-out visitor to the portal login and a team member back
  // to the app; see requirePortalViewer.
  const viewer = await requirePortalViewer();

  const client = await getPortalClient(viewer);
  if (!client) redirect("/portal/login");

  const accent = client.branding?.primaryColor ?? "var(--series-1)";

  return (
    <div className="min-h-screen bg-page">
      <header
        className="border-b-[3px] bg-surface"
        style={{ borderBottomColor: accent }}
      >
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/portal" className="flex items-center gap-3">
            {client.branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- client-supplied logo URL; not worth remote-pattern config
              <img
                src={client.branding.logoUrl}
                alt=""
                className="h-8 w-auto"
              />
            ) : null}
            <span>
              <span className="block text-sm font-semibold text-ink">
                {client.name}
              </span>
              <span className="block text-[11px] text-ink-muted">
                {client.domain}
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-3 text-xs">
            <Link href="/portal" className="text-ink-secondary hover:text-ink">
              Performance
            </Link>
            <Link
              href="/portal/reports"
              className="text-ink-secondary hover:text-ink"
            >
              Reports
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="rounded-lg border border-hairline px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-page hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-5 py-6">{children}</main>
    </div>
  );
}
