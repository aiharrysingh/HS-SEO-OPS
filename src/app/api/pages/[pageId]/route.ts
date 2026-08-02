import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authGuard } from "@/lib/auth";
import { PAGE_STATUSES, PAGE_TYPES } from "@/db/schema";
import { dataCutoff } from "@/lib/dates";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Curate a page's metadata by hand.
 *
 * Detection only fills in dates a page states about itself, which leaves the
 * landing pages and older posts that say nothing. Those are exactly the ones a
 * human knows and the machine cannot, so there has to be a way to type it in.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  const { pageId } = await params;

  let body: {
    publishedAt?: string | null;
    targetKeyword?: string | null;
    type?: string;
    status?: string;
    title?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const update: Partial<typeof schema.pages.$inferInsert> = {};

  if ("publishedAt" in body) {
    const value = body.publishedAt?.trim();
    if (!value) {
      update.publishedAt = null;
    } else if (!ISO_DATE.test(value)) {
      return NextResponse.json(
        { error: "Publish date must be YYYY-MM-DD." },
        { status: 400 },
      );
    } else if (value > dataCutoff()) {
      // A future publish date would make every milestone window incomplete
      // forever, so it is rejected rather than silently stored.
      return NextResponse.json(
        { error: `Publish date cannot be after the data cutoff (${dataCutoff()}).` },
        { status: 400 },
      );
    } else {
      update.publishedAt = value;
    }
  }

  if ("targetKeyword" in body) {
    update.targetKeyword = body.targetKeyword?.trim() || null;
  }
  if (body.title?.trim()) {
    update.title = body.title.trim();
  }
  if (body.type && (PAGE_TYPES as readonly string[]).includes(body.type)) {
    update.type = body.type as (typeof PAGE_TYPES)[number];
  }
  if (body.status && (PAGE_STATUSES as readonly string[]).includes(body.status)) {
    update.status = body.status as (typeof PAGE_STATUSES)[number];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const db = await getDb();
  const [row] = await db
    .update(schema.pages)
    .set(update)
    .where(eq(schema.pages.id, pageId))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "No such page." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, page: row });
}
