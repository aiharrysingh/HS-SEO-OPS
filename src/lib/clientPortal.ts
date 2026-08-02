import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser, type CurrentUser } from "./auth";

/**
 * The client-facing view's data layer (plan §8).
 *
 * The plan is blunt about the one rule here: *"Every query filtered by
 * `client_id` at the data layer, not in the UI — the one place where getting
 * it wrong is genuinely serious."*
 *
 * So these functions take **no client id argument**. They resolve it from the
 * signed session and nowhere else. A portal route cannot accidentally trust a
 * URL parameter, because there is no parameter to trust — the shape of the API
 * makes the mistake impossible rather than merely discouraged.
 */

export class NotAClientError extends Error {}

export type PortalViewer = {
  user: CurrentUser;
  clientId: string;
};

/**
 * The signed-in client user and the single client they may see.
 *
 * Returns null rather than throwing when nobody is signed in, so a route can
 * redirect to the portal login. Throws only when a *team* user reaches a
 * portal route, which is a routing mistake worth surfacing.
 */
export async function getPortalViewer(): Promise<PortalViewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "client" || !user.clientId) {
    throw new NotAClientError(
      "This area is for client accounts. Team members use the main app.",
    );
  }
  return { user, clientId: user.clientId };
}

/**
 * `getPortalViewer` with the redirects applied, for portal pages.
 *
 * Layouts and pages render independently, so every portal page has to resolve
 * the viewer itself rather than assume the layout already vetted it — and a
 * team member landing here should be moved to the app, not shown a stack
 * trace. Wrapping both outcomes here keeps that consistent instead of
 * repeating a try/catch on every screen.
 */
export async function requirePortalViewer(): Promise<PortalViewer> {
  let viewer: PortalViewer | null;
  try {
    viewer = await getPortalViewer();
  } catch (err) {
    if (err instanceof NotAClientError) redirect("/");
    throw err;
  }
  if (!viewer) redirect("/portal/login");
  return viewer;
}

/** Branding and identity for the portal chrome. */
export async function getPortalClient(viewer: PortalViewer) {
  const db = await getDb();
  const [client] = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      domain: schema.clients.domain,
      branding: schema.clients.branding,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, viewer.clientId))
    .limit(1);
  return client ?? null;
}

/**
 * Reports this client may read.
 *
 * Drafts are excluded at the query, not filtered in the component: §8 says the
 * client sees "the current report, plus history" and "nothing intermediate".
 * An unapproved draft is exactly the intermediate state that must never leak.
 */
export async function getPortalReports(viewer: PortalViewer) {
  const db = await getDb();
  return db
    .select({
      id: schema.reports.id,
      cadence: schema.reports.cadence,
      periodStart: schema.reports.periodStart,
      periodEnd: schema.reports.periodEnd,
      status: schema.reports.status,
      content: schema.reports.content,
      approvedAt: schema.reports.approvedAt,
    })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.clientId, viewer.clientId),
        inArray(schema.reports.status, ["approved", "sent"]),
      ),
    )
    .orderBy(desc(schema.reports.periodEnd));
}

/** One report, re-checked against the viewer's client — never trust the id alone. */
export async function getPortalReport(viewer: PortalViewer, reportId: string) {
  const db = await getDb();
  const [report] = await db
    .select()
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.id, reportId),
        // The client scope is part of the lookup, so a guessed id from another
        // client simply does not resolve.
        eq(schema.reports.clientId, viewer.clientId),
        inArray(schema.reports.status, ["approved", "sent"]),
      ),
    )
    .limit(1);
  return report ?? null;
}

/**
 * Whether a viewer may read a specific report, for the branded export page.
 *
 * Team members may read any report including drafts — that page is how they
 * check a draft before approving. Client users may read only their own, and
 * only once approved.
 */
export async function canReadReport(
  reportId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const user = await getCurrentUser();
  if (!user) return { allowed: false, reason: "Sign in to view this report." };

  if (user.role !== "client") return { allowed: true };

  if (!user.clientId) {
    return { allowed: false, reason: "This account isn't linked to a client." };
  }

  const db = await getDb();
  const [report] = await db
    .select({ id: schema.reports.id, status: schema.reports.status })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.id, reportId),
        eq(schema.reports.clientId, user.clientId),
      ),
    )
    .limit(1);

  if (!report) return { allowed: false, reason: "Report not found." };
  if (report.status === "draft") {
    return { allowed: false, reason: "This report hasn't been published yet." };
  }
  return { allowed: true };
}
