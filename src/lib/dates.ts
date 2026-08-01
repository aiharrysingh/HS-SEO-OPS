/**
 * The GSC lag decision (plan §6: "Decide this once and be consistent").
 *
 * Google Search Console data lags 2–3 days. Rather than dating reports to
 * "now" and quietly shipping an incomplete tail, every window in this app ends
 * at `dataCutoff()` — the most recent day GSC is expected to have settled — and
 * that date is surfaced in the UI and on every report.
 *
 * Both halves matter: a lagging window keeps the numbers honest, and stating
 * the cutoff stops clients asking why Monday's report omits the weekend.
 *
 * Change GSC_LAG_DAYS here and the whole app moves with it.
 */
export const GSC_LAG_DAYS = 3;

/** Milestones tracked from go-live, per plan §3 Phase 1. */
export const MILESTONES = [
  { key: "week1", label: "Week 1", days: 7 },
  { key: "month1", label: "Month 1", days: 30 },
  { key: "month3", label: "Month 3", days: 90 },
  { key: "month6", label: "Month 6", days: 180 },
] as const;

export type MilestoneKey = (typeof MILESTONES)[number]["key"];

/** `YYYY-MM-DD` in UTC. All dates in this app are calendar dates, never instants. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000,
  );
}

/** The latest date we consider complete in GSC. Everything reports up to here. */
export function dataCutoff(now: Date = new Date()): string {
  return addDays(toIsoDate(now), -GSC_LAG_DAYS);
}

export type DateWindow = { start: string; end: string };

/** A window of `days` ending at the data cutoff (inclusive). */
export function trailingWindow(
  days: number,
  now: Date = new Date(),
): DateWindow {
  const end = dataCutoff(now);
  return { start: addDays(end, -(days - 1)), end };
}

/** The equivalent window immediately before `w`, for period-on-period comparison. */
export function previousWindow(w: DateWindow): DateWindow {
  const len = daysBetween(w.start, w.end) + 1;
  return { start: addDays(w.start, -len), end: addDays(w.start, -1) };
}

/**
 * The same window one year earlier.
 *
 * Shifted by whole weeks (364 days) rather than by calendar year, so a Monday
 * still lines up against a Monday. Search traffic has a strong weekday shape;
 * a 365-day shift shifts the weekend into the middle of the window and
 * manufactures a swing that isn't there.
 */
export function yearAgoWindow(w: DateWindow): DateWindow {
  return { start: addDays(w.start, -364), end: addDays(w.end, -364) };
}

/** The last `weeks` complete weeks ending at the data cutoff. */
export function weekWindow(weeks = 1, now: Date = new Date()): DateWindow {
  return trailingWindow(7 * weeks, now);
}

/** A trailing 28-day window — four whole weeks, so weekday shape is balanced. */
export function monthWindow(now: Date = new Date()): DateWindow {
  return trailingWindow(28, now);
}

export type ReportCadenceKey = "weekly" | "monthly";

/**
 * The default period for a cadence. Both end at the data cutoff and span whole
 * weeks, which keeps every period-on-period and year-on-year comparison
 * weekday-aligned.
 */
export function cadenceWindow(
  cadence: ReportCadenceKey,
  now: Date = new Date(),
): DateWindow {
  return cadence === "weekly" ? weekWindow(1, now) : monthWindow(now);
}

export function formatWindow(w: DateWindow): string {
  return `${formatDate(w.start)} – ${formatDate(w.end)}`;
}

/**
 * The window for a page's milestone, measured from its publish date.
 * Returns null when the milestone has not fully elapsed yet — a half-finished
 * "month 3" number is worse than no number.
 */
export function milestoneWindow(
  publishedAt: string,
  days: number,
  now: Date = new Date(),
): DateWindow | null {
  const end = addDays(publishedAt, days - 1);
  if (end > dataCutoff(now)) return null;
  return { start: publishedAt, end };
}

export function formatDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
