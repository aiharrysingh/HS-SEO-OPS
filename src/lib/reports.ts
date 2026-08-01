import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { type ReportCadenceKey, cadenceWindow } from "./dates";
import { diagnose } from "./findings";
import { loadCurrentState } from "./references";
import { buildReportInput } from "./reportData";
import { GENERATOR_VERSION, writeReport } from "./reportWriter";
import { parseUpdates, updatesNear } from "./updates";

/**
 * Produces a draft report and stores it.
 *
 * No model is involved: the figures are computed, the rules fire against them,
 * and the writer lays the result out. Running this twice on unchanged data
 * produces byte-identical output, which is what makes a disputed number
 * answerable rather than arguable.
 *
 * The stored row keeps the figures it was written from, the generator version
 * and the date on the SEO facts, so a report from six months ago can still be
 * explained.
 */
export async function generateReportForClient(opts: {
  clientId: string;
  cadence: ReportCadenceKey;
  now?: Date;
}): Promise<{ reportId: string; regenerated: boolean }> {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const window = cadenceWindow(opts.cadence, now);

  // Load the shared reference first — if it is missing, stop before doing work.
  // The app must never fall back to SEO facts baked into this source.
  const state = await loadCurrentState(now);

  const [existing] = await db
    .select()
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.clientId, opts.clientId),
        eq(schema.reports.cadence, opts.cadence),
        eq(schema.reports.periodStart, window.start),
        eq(schema.reports.periodEnd, window.end),
      ),
    )
    .limit(1);

  if (existing?.status === "approved" || existing?.status === "sent") {
    throw new Error(
      `The ${opts.cadence} report for ${window.start}–${window.end} is already ` +
        `${existing.status}. Regenerating would discard approved copy.`,
    );
  }

  const input = await buildReportInput({
    clientId: opts.clientId,
    cadence: opts.cadence,
    window,
  });

  const updates = updatesNear(parseUpdates(state.content), window);
  const findings = diagnose(input, updates);

  const markdown = writeReport({
    input,
    findings,
    workDelivered: existing?.workDelivered ?? "",
    provenance: state.provenance,
    referenceStale: state.stale,
  });

  const values = {
    clientId: opts.clientId,
    cadence: opts.cadence,
    periodStart: window.start,
    periodEnd: window.end,
    status: "draft" as const,
    content: markdown,
    inputSnapshot: { input, findings, updates },
    model: GENERATOR_VERSION,
    referenceDate: state.verifiedAt,
    generatedAt: new Date(),
  };

  const [row] = await db
    .insert(schema.reports)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.reports.clientId,
        schema.reports.cadence,
        schema.reports.periodStart,
        schema.reports.periodEnd,
      ],
      set: {
        content: values.content,
        inputSnapshot: values.inputSnapshot,
        model: values.model,
        referenceDate: values.referenceDate,
        generatedAt: values.generatedAt,
        status: values.status,
        approvedAt: null,
        approvedBy: null,
      },
    })
    .returning({ id: schema.reports.id });

  return { reportId: row.id, regenerated: Boolean(existing) };
}

export async function listReports(clientId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.clientId, clientId))
    .orderBy(desc(schema.reports.periodEnd), desc(schema.reports.cadence));
}

export async function getReport(reportId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ report: schema.reports, client: schema.clients })
    .from(schema.reports)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.reports.clientId))
    .where(eq(schema.reports.id, reportId))
    .limit(1);
  return row ?? null;
}

/**
 * Minutes between the draft landing and a human approving it.
 *
 * Plan §9 asks for hours saved to be instrumented from day one. This is a proxy
 * — it measures elapsed time, not attention — but it is automatic, and it
 * answers the question the plan actually cares about: is this getting faster.
 */
export function reviewMinutes(report: {
  generatedAt: Date | null;
  approvedAt: Date | null;
}): number | null {
  if (!report.generatedAt || !report.approvedAt) return null;
  return Math.max(
    0,
    Math.round(
      (report.approvedAt.getTime() - report.generatedAt.getTime()) / 60_000,
    ),
  );
}
