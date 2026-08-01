import { addDays, type DateWindow } from "./dates";

/**
 * Confirmed Google algorithm updates, parsed out of `current-state.md`.
 *
 * The `client-report` standard is emphatic about this: "Do not attribute
 * movement to an algorithm update without checking the dates against the
 * timeline. Match the date first." That is a date-range intersection, which is
 * exactly the kind of thing to do in code rather than leave to judgement — and
 * it is the most common way a client report ends up confidently wrong.
 *
 * The timeline lives in the shared reference file rather than in this source,
 * so a new update is recorded once and both the app and Cowork pick it up.
 */

export type AlgorithmUpdate = {
  /** As written in the file, e.g. "Mar 2026". */
  label: string;
  name: string;
  notes: string;
  /** Inclusive range the update was rolling out. */
  start: string;
  end: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses the "Confirmed updates" markdown table.
 *
 * Rows look like:
 *   | Mar 2025 | Core update | Completed |
 *   | Jun–Jul 2025 | Core update | Jun 30 – Jul 17 |
 *
 * The date column is prose, so a precise day range is used when the notes give
 * one and the whole month (or month span) is used otherwise. Erring wide is
 * deliberate: a false "no update was running" is worse than a caveated maybe.
 */
export function parseUpdates(currentState: string): AlgorithmUpdate[] {
  const out: AlgorithmUpdate[] = [];

  for (const line of currentState.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;

    const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const label = cells[0];
    // "Mar 2025" or "Jun–Jul 2025" (en dash or hyphen).
    const m = label.match(
      /^([A-Za-z]{3})[a-z]*(?:\s*[–-]\s*([A-Za-z]{3})[a-z]*)?\s+(\d{4})$/,
    );
    if (!m) continue;

    const year = Number(m[3]);
    const startMonth = MONTHS[m[1].toLowerCase()];
    const endMonth = m[2] ? MONTHS[m[2].toLowerCase()] : startMonth;
    if (!startMonth || !endMonth) continue;

    const name = cells[1].replace(/\*\*/g, "").trim();
    const notes = (cells[2] ?? "").replace(/\*\*/g, "").trim();

    let start = iso(year, startMonth, 1);
    let end = iso(year, endMonth, lastDayOfMonth(year, endMonth));

    // Narrow to the exact window when the notes carry one, e.g. "Jun 30 – Jul 17"
    // or "Dec 11 – Dec 29".
    const precise = notes.match(
      /([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s*[–-]\s*(?:([A-Za-z]{3})[a-z]*\s+)?(\d{1,2})/,
    );
    if (precise) {
      const pStartMonth = MONTHS[precise[1].toLowerCase()];
      const pEndMonth = precise[3]
        ? MONTHS[precise[3].toLowerCase()]
        : pStartMonth;
      if (pStartMonth && pEndMonth) {
        start = iso(year, pStartMonth, Number(precise[2]));
        end = iso(year, pEndMonth, Number(precise[4]));
      }
    } else {
      const from = notes.match(/from\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})/i);
      if (from) {
        const fm = MONTHS[from[1].toLowerCase()];
        if (fm) start = iso(year, fm, Number(from[2]));
      }
    }

    out.push({ label, name, notes, start, end });
  }

  return out;
}

/**
 * Updates whose rollout overlaps the reporting window, or the fortnight before
 * it — ranking changes surface in traffic after the rollout, not during it.
 */
export function updatesNear(
  updates: AlgorithmUpdate[],
  window: DateWindow,
  leadDays = 14,
): AlgorithmUpdate[] {
  const from = addDays(window.start, -leadDays);
  return updates.filter((u) => u.start <= window.end && u.end >= from);
}
