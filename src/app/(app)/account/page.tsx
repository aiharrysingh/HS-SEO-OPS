import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { NoGoogleTokenError, listGscPropertiesForUser } from "@/lib/gscAccounts";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { LinkPropertyForm } from "@/components/LinkPropertyForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const clients = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      gscProperty: schema.clients.gscProperty,
    })
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));

  let sites: { siteUrl: string; permissionLevel: string }[] = [];
  let error: string | null = null;
  try {
    sites = await listGscPropertiesForUser(user.id);
  } catch (err) {
    error = err instanceof NoGoogleTokenError
      ? err.message
      : `Could not reach Search Console: ${err instanceof Error ? err.message : String(err)}`;
  }

  const usedBy = new Map(
    clients.filter((c) => c.gscProperty).map((c) => [c.gscProperty as string, c.name]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Account</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Signed in as {user.name ?? user.email}
          {user.name && (
            <span className="text-ink-muted"> · {user.email}</span>
          )}
          {" · "}
          <span className="capitalize">{user.role}</span>
        </p>
      </div>

      <Card>
        <CardHeader
          title="Search Console properties"
          subtitle="Every domain this Google account has read access to on Search Console."
        />
        <div className="p-4">
          {error && (
            <p className="mb-4 rounded-lg bg-wash-critical px-3 py-2 text-xs text-critical">
              {error}
            </p>
          )}

          {!error && sites.length === 0 && (
            <EmptyState title="No Search Console properties found">
              This Google account has no properties on Search Console, or
              hasn&apos;t granted access yet.
            </EmptyState>
          )}

          {sites.length > 0 && (
            <ul className="divide-y divide-hairline">
              {sites.map((s) => (
                <li
                  key={s.siteUrl}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{s.siteUrl}</p>
                    <p className="text-xs text-ink-muted">{s.permissionLevel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {usedBy.has(s.siteUrl) ? (
                      <Badge tone="good">Linked to {usedBy.get(s.siteUrl)}</Badge>
                    ) : (
                      <LinkPropertyForm siteUrl={s.siteUrl} clients={clients} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
