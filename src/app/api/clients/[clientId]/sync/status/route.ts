import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authGuard } from "@/lib/auth";
import { isSyncActive } from "@/lib/gsc";

export const dynamic = "force-dynamic";

/**
 * Polled by SyncButton while a sync is running. Deliberately a bare indexed
 * row lookup, not `router.refresh()` — cheap enough to poll every few seconds
 * for the minutes a first backfill can take, unlike re-running the whole
 * client page's server component tree on every tick.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;
  const db = await getDb();
  const [client] = await db
    .select({
      syncStartedAt: schema.clients.syncStartedAt,
      lastSyncedAt: schema.clients.lastSyncedAt,
      lastSyncError: schema.clients.lastSyncError,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) {
    return NextResponse.json({ error: "No such client." }, { status: 404 });
  }

  return NextResponse.json({
    syncing: isSyncActive(client.syncStartedAt),
    startedAt: client.syncStartedAt?.toISOString() ?? null,
    lastSyncedAt: client.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: client.lastSyncError,
  });
}
