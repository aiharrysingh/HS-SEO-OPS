/** Compact for display (12.9K), full for tables. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1_000_000)
    return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function full(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

export function percent(n: number, dp = 1): string {
  return `${(n * 100).toFixed(dp)}%`;
}

export function position(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

export type Delta = {
  /** Fractional change, e.g. 0.12 for +12%. null when there is no baseline. */
  ratio: number | null;
  absolute: number;
  direction: "up" | "down" | "flat";
};

export function delta(current: number, previous: number): Delta {
  const absolute = current - previous;
  const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  return {
    absolute,
    direction,
    ratio: previous === 0 ? null : absolute / previous,
  };
}

export function formatDelta(d: Delta): string {
  if (d.direction === "flat") return "0%";
  // No baseline to divide by. Printing the raw count here would sit in a column
  // of percentages and read as one — a page going 0 → 35 clicks is "new", not
  // "+35%".
  if (d.ratio === null) return d.absolute > 0 ? "new" : full(d.absolute);
  const pct = d.ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * Rank movement, in places rather than percent.
 *
 * "Average position rose 5.6%" is not how anyone doing this job reads a
 * ranking change — they read "dropped half a place". Percent also misleads:
 * the same 1.0 move is 33% at position 3 and 2% at position 50.
 */
export function formatDeltaPlaces(d: Delta): string {
  if (d.direction === "flat") return "no change";
  const places = Math.abs(d.absolute);
  return `${places.toFixed(places < 10 ? 1 : 0)} ${places === 1 ? "place" : "places"}`;
}

/**
 * Average SERP position is the one metric where down is good. Every delta in
 * the UI passes through here rather than assuming up = green.
 */
export function isImprovement(d: Delta, lowerIsBetter = false): boolean | null {
  if (d.direction === "flat") return null;
  const up = d.direction === "up";
  return lowerIsBetter ? !up : up;
}
