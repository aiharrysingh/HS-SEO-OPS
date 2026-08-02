import { NextResponse } from "next/server";
import { authGuard } from "@/lib/auth";
import { reviewDraft } from "@/lib/draftReview";

export const dynamic = "force-dynamic";

/**
 * Reviews a draft. Deliberately stateless — nothing is written to the database.
 *
 * A review is a pre-publish check, not a record: you paste, fix, publish. Plan
 * §5 says resist adding tables until something needs them, and nothing here
 * needs one. If review history turns out to matter, that is the moment to add
 * storage, not before.
 */
export async function POST(req: Request) {
  const blocked = await authGuard();
  if (blocked) return blocked;

  let body: {
    markdown?: string;
    targetKeyword?: string;
    title?: string;
    metaDescription?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const markdown = body.markdown?.trim();
  if (!markdown) {
    return NextResponse.json({ error: "Paste a draft first." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    review: reviewDraft({
      markdown,
      targetKeyword: body.targetKeyword,
      title: body.title,
      metaDescription: body.metaDescription,
    }),
  });
}
