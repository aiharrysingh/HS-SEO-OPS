import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DraftReviewer } from "@/components/DraftReviewer";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ keyword?: string }>;
}) {
  const { clientId } = await params;
  const { keyword } = await searchParams;

  const db = await getDb();
  const [client] = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) notFound();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Draft review
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Check a piece for {client.name} before it goes live — AI writing
          tells, on-page SEO and whether an AI engine could cite it.
        </p>
      </header>

      <DraftReviewer defaultKeyword={keyword ?? ""} />
    </div>
  );
}
