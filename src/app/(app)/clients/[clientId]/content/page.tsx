import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  RANGE_PRESETS,
  dataCutoff,
  formatDate,
  isTrailingWindow,
  parseWindow,
  windowLabel as describeWindow,
  withFilters,
} from "@/lib/dates";
import { getOpportunities, getPlannedContent } from "@/lib/opportunities";
import { compact, full, percent, position } from "@/lib/format";
import { DateRangePicker } from "@/components/DateRangePicker";
import { PlanContentButton } from "@/components/PlanContentButton";
import { PlannedRowActions } from "@/components/PlannedRowActions";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    days?: string;
    from?: string;
    to?: string;
    kind?: string;
  }>;
}) {
  const { clientId } = await params;
  const sp = await searchParams;
  const window = parseWindow(sp);
  const windowLabel = describeWindow(window);
  const activePreset =
    RANGE_PRESETS.find((p) => isTrailingWindow(window, p.days))?.days ?? null;
  const kind = sp.kind === "improve" || sp.kind === "create" ? sp.kind : "all";

  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) notFound();

  const [opportunities, planned] = await Promise.all([
    getOpportunities(clientId, window),
    getPlannedContent(clientId),
  ]);

  const improve = opportunities.filter((o) => o.kind === "improve");
  const create = opportunities.filter((o) => o.kind === "create");
  const shown =
    kind === "improve" ? improve : kind === "create" ? create : opportunities;

  const tabs = [
    { key: "all", label: `All ${opportunities.length}` },
    { key: "create", label: `Write ${create.length}` },
    { key: "improve", label: `Improve ${improve.length}` },
  ] as const;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={withFilters(`/clients/${clientId}`, window)}
            className="text-xs text-ink-secondary hover:underline"
          >
            ← {client.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
            Content plan
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Search terms worth writing for, from {windowLabel.toLowerCase()} of
            Search Console data.
          </p>
        </div>
        <DateRangePicker
          window={window}
          cutoff={dataCutoff()}
          presets={RANGE_PRESETS}
          activePreset={activePreset}
        />
      </header>

      <Card>
        <CardHeader
          title="Planned content"
          subtitle="Pieces on the calendar. Marking one live turns its planned date into the go-live date milestones measure from."
        />
        {planned.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing planned yet">
              Use <strong className="font-medium text-ink">Plan</strong> on an
              opportunity below to add the first piece.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                  <th scope="col" className="px-4 py-2 font-medium">Title</th>
                  <th scope="col" className="px-3 py-2 font-medium">Target keyword</th>
                  <th scope="col" className="px-3 py-2 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2 font-medium">Planned for</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {planned.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-hairline last:border-0 hover:bg-page"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{p.title}</div>
                      <div className="truncate text-xs text-ink-muted">{p.url}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">
                      {p.targetKeyword ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={p.type === "landing" ? "blue" : "neutral"}>
                        {p.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">
                      {p.plannedFor ? formatDate(p.plannedFor) : "No date"}
                    </td>
                    <td className="px-4 py-2.5">
                      <PlannedRowActions clientId={clientId} pageId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Keyword opportunities"
          subtitle="Terms ranking between positions 5 and 20 — Google already shows the site for these, so they are the cheapest ground to gain. Branded terms are excluded."
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <div className="inline-flex rounded-lg border border-hairline bg-page p-0.5">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={withFilters(`/clients/${clientId}/content`, window, {
                  kind: t.key === "all" ? undefined : t.key,
                })}
                scroll={false}
                aria-current={kind === t.key ? "true" : undefined}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  kind === t.key
                    ? "bg-surface font-medium text-ink shadow-sm"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <p className="ml-auto text-xs text-ink-muted">
            &ldquo;Existing page&rdquo; is a text match on title and keyword, not
            Search Console attribution.
          </p>
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No opportunities in this window">
              Nothing is ranking between positions 5 and 20 with enough
              impressions to act on. Try a longer date range.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-secondary">
                  <th scope="col" className="px-4 py-2 font-medium">Search term</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Impressions</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Clicks</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">CTR</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Position</th>
                  <th scope="col" className="px-3 py-2 font-medium">Existing page</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Plan</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr
                    key={o.query}
                    className="border-b border-hairline last:border-0 hover:bg-page"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{o.query}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">
                      {compact(o.impressions)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {full(o.clicks)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {percent(o.ctr, 2)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-secondary">
                      {position(o.position)}
                    </td>
                    <td className="px-3 py-2.5">
                      {o.matchedPage ? (
                        <Link
                          href={withFilters(
                            `/clients/${clientId}/pages/${o.matchedPage.id}`,
                            window,
                          )}
                          className="text-ink-secondary hover:underline"
                        >
                          {o.matchedPage.title}
                        </Link>
                      ) : (
                        <Badge tone="warning">Nothing targets this</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <PlanContentButton
                          clientId={clientId}
                          query={o.query}
                          suggestedType={o.matchedPage ? "landing" : "blog"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
