import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTeamUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Save edits, record the work log, or approve. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { user, blocked } = await requireTeamUser();
  if (blocked) return blocked;

  const { reportId } = await params;
  const db = await getDb();

  let body: {
    content?: string;
    workDelivered?: string;
    status?: "draft" | "approved" | "sent";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "No such report." }, { status: 404 });
  }

  const update: Partial<typeof schema.reports.$inferInsert> = {};
  if (typeof body.content === "string") update.content = body.content;
  if (typeof body.workDelivered === "string") {
    update.workDelivered = body.workDelivered;
  }

  if (body.status && body.status !== existing.status) {
    update.status = body.status;
    if (body.status === "approved") {
      // Stamped once, on the transition — re-approving shouldn't reset the
      // clock that plan §9's measurement depends on.
      update.approvedAt = existing.approvedAt ?? new Date();
      update.approvedBy = user.email;
    }
    if (body.status === "draft") {
      update.approvedAt = null;
      update.approvedBy = null;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const [row] = await db
    .update(schema.reports)
    .set(update)
    .where(eq(schema.reports.id, reportId))
    .returning();

  return NextResponse.json({ ok: true, report: row });
}
