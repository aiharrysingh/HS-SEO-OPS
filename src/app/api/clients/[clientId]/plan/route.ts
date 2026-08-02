import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authGuard } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** URL-safe slug from a title or keyword, for the planned page's intended path. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Adds a piece to the content calendar.
 *
 * A planned piece is a `pages` row with `status = "draft"` — no separate table
 * (plan §5). When it goes live the row flips to `"live"` and its planned date
 * becomes the real go-live date the milestone columns measure from.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  let body: {
    title?: string;
    targetKeyword?: string;
    plannedFor?: string;
    type?: "blog" | "landing";
    url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "A title is required." }, { status: 400 });
  }

  const db = await getDb();
  const [client] = await db
    .select({ domain: schema.clients.domain })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) {
    return NextResponse.json({ error: "No such client." }, { status: 404 });
  }

  const type = body.type === "landing" ? "landing" : "blog";
  const url =
    body.url?.trim() ||
    `https://${client.domain}/${type === "blog" ? "blog/" : ""}${slugify(
      body.targetKeyword || title,
    )}`;

  // `pages` is unique on (clientId, url); a planned slug colliding with an
  // existing page means it is already covered, which is worth saying rather
  // than failing on a constraint.
  const existing = await db
    .select({ id: schema.pages.id, title: schema.pages.title, status: schema.pages.status })
    .from(schema.pages)
    .where(and(eq(schema.pages.clientId, clientId), eq(schema.pages.url, url)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      {
        error: `That URL is already tracked as "${existing[0].title}" (${existing[0].status}).`,
      },
      { status: 409 },
    );
  }

  const [row] = await db
    .insert(schema.pages)
    .values({
      clientId,
      url,
      title,
      type,
      status: "draft",
      targetKeyword: body.targetKeyword?.trim() || null,
      // The intended publish date. Same column the milestones read, so nothing
      // has to be migrated when the piece goes live.
      publishedAt: body.plannedFor?.trim() || null,
    })
    .returning();

  return NextResponse.json({ ok: true, page: row }, { status: 201 });
}

/** Mark a planned piece live, or drop it from the calendar. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { clientId } = await params;

  let body: { pageId?: string; action?: "publish" | "remove"; plannedFor?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body.pageId) {
    return NextResponse.json({ error: "pageId is required." }, { status: 400 });
  }

  const db = await getDb();
  const where = and(
    eq(schema.pages.id, body.pageId),
    eq(schema.pages.clientId, clientId),
  );

  if (body.action === "remove") {
    const [row] = await db.delete(schema.pages).where(where).returning();
    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const update: Partial<typeof schema.pages.$inferInsert> = {};
  if (body.action === "publish") update.status = "live";
  if (body.plannedFor) update.publishedAt = body.plannedFor;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const [row] = await db.update(schema.pages).set(update).where(where).returning();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, page: row });
}
