import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb, schema, usingEmbeddedPostgres } from "@/db";
import { ClientNav, ThemeToggle } from "@/components/Nav";

// Every screen reads live data; nothing here is worth prerendering.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await getDb();
  const clients = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      domain: schema.clients.domain,
    })
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-hairline bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 block px-3">
          <span className="block text-sm font-semibold tracking-tight text-ink">
            HS SEO Ops
          </span>
          <span className="block text-[11px] text-ink-muted">
            Content performance
          </span>
        </Link>

        <ClientNav clients={clients} />

        <div className="mt-auto space-y-2 px-1 pt-4">
          {usingEmbeddedPostgres() && (
            <p className="rounded-lg bg-page px-2.5 py-2 text-[11px] leading-snug text-ink-muted">
              Embedded Postgres. Set{" "}
              <code className="font-mono">DATABASE_URL</code> to point at a
              hosted database.
            </p>
          )}
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile: the sidebar collapses to a horizontal client strip. */}
      <div className="min-w-0 flex-1">
        <div className="border-b border-hairline bg-surface px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold text-ink">
              HS SEO Ops
            </Link>
            <ThemeToggle />
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="shrink-0 rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-secondary"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>

        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
