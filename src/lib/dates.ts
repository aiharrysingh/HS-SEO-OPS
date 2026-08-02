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

/** The presets offered in the UI, and the fallback when no range is given. */
export const RANGE_PRESETS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "90 days" },
] as const;

export const DEFAULT_RANGE_DAYS = 28;

/**
 * Longest range we will accept. GSC retains 16 months, so anything beyond this
 * can only return empty days — better to clamp than to render a mostly-blank
 * chart that looks like a data loss.
 */
export const MAX_RANGE_DAYS = 480;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = parseIsoDate(s);
  // Rejects "2026-02-31" and friends, which Date happily rolls over.
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === s;
}

/**
 * Resolves the window a screen should show from its URL search params.
 *
 * Accepts either an explicit `from`/`to` range or a `days` preset, and is
 * deliberately total: anything malformed, reversed, or out of range falls back
 * to the default window rather than throwing. A hand-edited URL should never
 * be able to 500 a dashboard.
 *
 * `end` is always clamped to `dataCutoff()` so the GSC lag decision at the top
 * of this file stays the single source of truth — a user cannot ask for days
 * Google has not settled yet.
 */
export function parseWindow(
  params: { from?: string; to?: string; days?: string } = {},
  now: Date = new Date(),
): DateWindow {
  const cutoff = dataCutoff(now);

  if (isValidIsoDate(params.from) && isValidIsoDate(params.to)) {
    // Tolerate a reversed range rather than rejecting it.
    let [start, end] =
      params.from <= params.to
        ? [params.from, params.to]
        : [params.to, params.from];

    if (end > cutoff) end = cutoff;
    if (start > end) start = end;
    if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) {
      start = addDays(end, -(MAX_RANGE_DAYS - 1));
    }
    return { start, end };
  }

  const days = Number(params.days);
  if (Number.isInteger(days) && days > 0) {
    return trailingWindow(Math.min(days, MAX_RANGE_DAYS), now);
  }

  return trailingWindow(DEFAULT_RANGE_DAYS, now);
}

/**
 * How a window should be described in a label.
 *
 * A window that is simply the last N days ending at the cutoff reads as
 * "Last 28 days" — the phrasing the screens used before custom ranges existed.
 * Anything else is spelled out in full, because "last 43 days" tells a reader
 * nothing about which 43 days they are looking at.
 */
export function windowLabel(w: DateWindow, now: Date = new Date()): string {
  const len = daysBetween(w.start, w.end) + 1;
  if (w.end === dataCutoff(now)) return `Last ${len} days`;
  return formatWindow(w);
}

/** True when this is a plain trailing window of exactly `days`, for preset highlighting. */
export function isTrailingWindow(
  w: DateWindow,
  days: number,
  now: Date = new Date(),
): boolean {
  const t = trailingWindow(days, now);
  return t.start === w.start && t.end === w.end;
}

/**
 * Carries the active filters onto another in-app link.
 *
 * Without this a filter is a toy: clicking into a page and back silently
 * resets the range you were looking at.
 */
export function withFilters(
  href: string,
  w: DateWindow,
  extra: Record<string, string | undefined> = {},
  now: Date = new Date(),
): string {
  const params = new URLSearchParams();
  // Only spell the range out when it isn't the default, to keep URLs clean.
  if (!isTrailingWindow(w, DEFAULT_RANGE_DAYS, now)) {
    params.set("from", w.start);
    params.set("to", w.end);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${href}?${qs}` : href;
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

/**
 * Month and two-digit year, for chart axes on ranges that cross a calendar
 * year. "Jun 25" is unambiguous where a bare "3 Jun" is not, and it stays
 * narrow enough to fit several labels across a plot.
 */
export function formatDateAxis(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
