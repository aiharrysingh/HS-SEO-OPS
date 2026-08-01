import type { Finding } from "./findings";
import { pct } from "./findings";
import type { ReportInput } from "./reportData";
import { formatDate } from "./dates";

/**
 * Assembles the report markdown from computed figures and fired findings.
 *
 * The structure follows the `client-report` standard's output format. Nothing
 * here decides anything — every claim arrives already made by a rule in
 * findings.ts, with its evidence attached. This module's only job is to put it
 * in the order a client reads and in sentences rather than fragments.
 */

/** Bumped when the rules or the layout change, so an old report stays explicable. */
export const GENERATOR_VERSION = "rules-v1";

export function writeReport(opts: {
  input: ReportInput;
  findings: Finding[];
  workDelivered: string;
  provenance: string;
  referenceStale: boolean;
}): string {
  const { input, findings, workDelivered } = opts;
  const cur = input.current;
  const prev = input.previous;
  const yoy = input.yearAgo;

  const out: string[] = [];

  out.push(`# ${input.client.name} — SEO Performance`);
  out.push(
    `**Period:** ${formatDate(input.period.start)} – ${formatDate(input.period.end)} | ` +
      `**vs:** preceding ${input.cadence === "weekly" ? "7 days" : "28 days"}` +
      (yoy ? " and the same period last year" : ""),
  );
  out.push("");

  if (opts.referenceStale) {
    out.push(
      `> **The SEO reference facts behind this report are out of date.** ` +
        `${opts.provenance} Anything below touching algorithm updates or search ` +
        `features should be re-checked before this is sent.`,
    );
    out.push("");
  }

  /* --- The short version ------------------------------------------------- */
  out.push("## The short version");
  out.push(shortVersion(input, findings));
  out.push("");

  /* --- Performance ------------------------------------------------------- */
  out.push("## Performance");
  out.push(
    row(["Metric", "This period", "Prior", "Change", ...(yoy ? ["Last year"] : [])]),
    row(["---", "---", "---", "---", ...(yoy ? ["---"] : [])]),
    row([
      "Clicks",
      num(cur.all.clicks),
      num(prev.all.clicks),
      pct(change(cur.all.clicks, prev.all.clicks)),
      ...(yoy ? [num(yoy.all.clicks)] : []),
    ]),
    row([
      "Impressions",
      num(cur.all.impressions),
      num(prev.all.impressions),
      pct(change(cur.all.impressions, prev.all.impressions)),
      ...(yoy ? [num(yoy.all.impressions)] : []),
    ]),
    row([
      "Average position",
      cur.all.position?.toFixed(1) ?? "—",
      prev.all.position?.toFixed(1) ?? "—",
      // Subtract the *displayed* values, not the raw ones. Otherwise a reader
      // does 5.0 − 4.3 in their head, gets 0.7, and the table says 0.6.
      positionDelta(cur.all.position, prev.all.position),
      ...(yoy ? [yoy.all.position?.toFixed(1) ?? "—"] : []),
    ]),
    row([
      "CTR",
      `${(cur.all.ctr * 100).toFixed(2)}%`,
      `${(prev.all.ctr * 100).toFixed(2)}%`,
      `${((cur.all.ctr - prev.all.ctr) * 100).toFixed(2)}pp`,
      ...(yoy ? [`${(yoy.all.ctr * 100).toFixed(2)}%`] : []),
    ]),
  );
  out.push("");

  if (input.brandTermsConfigured) {
    out.push(
      `**Non-branded:** ${num(cur.nonBranded.clicks)} clicks, ` +
        `${pct(change(cur.nonBranded.clicks, prev.nonBranded.clicks))} on ${num(prev.nonBranded.clicks)}. ` +
        `This is the number that reflects the work. Branded search was ` +
        `${num(cur.branded.clicks)} clicks, ${pct(change(cur.branded.clicks, prev.branded.clicks))}.`,
    );
  } else {
    out.push(
      "**Non-branded:** not available — no brand terms are configured for this " +
        "client, so branded and non-branded search cannot be separated. Setting " +
        "them up is the single biggest improvement available to this report.",
    );
  }
  out.push("");

  /* --- What moved and why ------------------------------------------------- */
  const diagnostic = findings.filter((f) => f.severity !== "context");
  out.push("## What moved and why");
  if (diagnostic.length === 0) {
    out.push(
      "Nothing moved enough to need explaining. The figures above are within " +
        "normal variation for this period.",
    );
    out.push("");
  } else {
    for (const f of diagnostic) {
      out.push(`### ${f.title}`);
      out.push(f.detail);
      if (f.evidence.length > 0) {
        out.push("");
        for (const e of f.evidence) out.push(`- ${e}`);
      }
      if (f.confidence !== "measured") {
        out.push("");
        out.push(
          f.confidence === "likely"
            ? "*This is the best-supported reading of the data, not a confirmed cause.*"
            : "*This is one possible explanation; the data does not confirm it.*",
        );
      }
      out.push("");
    }
  }

  /* --- Top pages ---------------------------------------------------------- */
  if (input.topPages.length > 0) {
    out.push("## Top pages");
    out.push(row(["Page", "Clicks", "Change"]), row(["---", "---", "---"]));
    for (const p of input.topPages.slice(0, 8)) {
      out.push(
        row([
          p.path,
          num(p.clicks),
          p.previousClicks === 0
            ? "new"
            : `${signed(p.change)} (${pct(change(p.clicks, p.previousClicks))})`,
        ]),
      );
    }
    out.push("");
  }

  /* --- Context findings --------------------------------------------------- */
  const context = findings.filter((f) => f.severity === "context");
  if (context.length > 0) {
    out.push("## Worth knowing");
    for (const f of context) {
      out.push(`**${f.title}.** ${f.detail}`);
      if (f.evidence.length > 0) {
        out.push("");
        for (const e of f.evidence) out.push(`- ${e}`);
      }
      out.push("");
    }
  }

  /* --- Work delivered ----------------------------------------------------- */
  out.push("## Work delivered");
  out.push(
    workDelivered.trim() ||
      "_Not recorded for this period, so nothing above can be tied to work done. " +
        "Fill in the work log and regenerate to connect the two._",
  );
  out.push("");

  /* --- Next period -------------------------------------------------------- */
  out.push("## Next period");
  const actions = nextActions(input, findings);
  actions.forEach((a, i) => out.push(`${i + 1}. ${a}`));
  out.push("");

  /* --- Notes -------------------------------------------------------------- */
  out.push("## Notes");
  out.push(
    `Search Console publishes roughly three days behind, so this period ends ` +
      `${input.dataCutoff} rather than today.`,
  );
  for (const w of input.missingWindows) {
    out.push(`- Comparison unavailable: ${w}.`);
  }
  out.push(
    "- Search Console data only. No analytics, conversion or revenue data is " +
      "included in this report.",
  );
  out.push(
    "- AI Overview impressions are not exposed through the Search Console API, " +
      "so any statement about AI visibility here is a floor, not a measurement.",
  );
  out.push("");
  out.push(
    `<sub>Generated ${GENERATOR_VERSION} from Search Console data. ${opts.provenance}</sub>`,
  );

  return out.join("\n");
}

/**
 * Three or four sentences for someone who reads only this.
 *
 * Built from the findings that fired rather than from a template with the
 * numbers dropped in, so a flat period and a page falling off the index don't
 * open the same way.
 */
function shortVersion(input: ReportInput, findings: Finding[]): string {
  const cur = input.current;
  const prev = input.previous;
  const clicks = change(cur.all.clicks, prev.all.clicks);
  const sentences: string[] = [];

  const headline = input.brandTermsConfigured
    ? `Non-branded clicks — the number that reflects the work — ${direction(change(cur.nonBranded.clicks, prev.nonBranded.clicks))} to ${num(cur.nonBranded.clicks)}, against ${num(cur.all.clicks)} total.`
    : `Clicks ${direction(clicks)} to ${num(cur.all.clicks)}.`;
  sentences.push(headline);

  const lead = findings.find((f) => f.severity === "critical") ?? findings.find((f) => f.severity === "notable");
  if (lead) sentences.push(`${lead.title}.`);

  const zeroed = findings.find((f) => f.id === "zeroed");
  if (zeroed && zeroed !== lead) {
    sentences.push(`${zeroed.title} — worth checking before anything else here.`);
  }

  const unexplained = findings.find((f) => f.id === "unexplained");
  if (unexplained) {
    sentences.push(
      "The data does not explain the movement, so this report says what to check rather than offering a cause.",
    );
  } else if (findings.some((f) => f.id === "flat")) {
    // Only call a period uneventful when nothing actually fired. With a finding
    // above it, the flat total is what's concealing the movement.
    sentences.push(
      lead
        ? "The total barely moved, which masks that rather than contradicting it."
        : "There is no story this period, and that is a fair result rather than a hidden problem.",
    );
  }

  return sentences.join(" ");
}

/**
 * Concrete next steps derived from what actually fired. The standard is explicit
 * that "continue optimising content" is not an action.
 */
function nextActions(input: ReportInput, findings: Finding[]): string[] {
  const actions: string[] = [];
  const has = (id: string) => findings.some((f) => f.id === id);

  if (has("zeroed")) {
    actions.push(
      "Check the pages that dropped to zero for indexing, redirects and status codes — this is a fault to fix, not a trend to watch.",
    );
  }
  if (has("ai-overview")) {
    const q = input.aiOverviewCandidates[0];
    actions.push(
      `Rework the pages behind ${q ? `“${q.query}”` : "the affected queries"} so they give a reason to click beyond the answer itself — a tool, a calculator, or the next step. An AI Overview answers the question; it does not do the next thing.`,
    );
  }
  if (has("ranking-loss")) {
    actions.push(
      "Review the pages that lost position against what now outranks them, and decide whether the gap is depth, freshness or intent.",
    );
  }
  if (has("concentrated")) {
    const p = input.fallingPages[0] ?? input.risingPages[0];
    actions.push(
      `Focus on ${p ? p.path : "the single page driving the change"} rather than spreading effort — the movement is concentrated there.`,
    );
  }
  if (has("ctr-compression")) {
    actions.push(
      "Check what the results page now looks like for the affected queries; the listing itself is losing the click, so titles, descriptions and structured data are the lever.",
    );
  }
  if (!input.brandTermsConfigured) {
    actions.push(
      "Configure brand terms for this client so branded and non-branded search can be separated — without it the headline number mixes brand awareness with SEO.",
    );
  }
  if (has("unexplained")) {
    actions.push(
      "Work through the checks listed above and confirm a cause before committing effort in any direction.",
    );
  }

  if (actions.length === 0) {
    actions.push(
      "Hold the current approach — nothing in this period calls for a change of direction.",
    );
    if (input.publishedInPeriod.length === 0) {
      actions.push(
        "No new pages went live this period; publishing is the main lever on non-branded growth.",
      );
    }
  }

  return actions.slice(0, 5);
}

/* ------------------------------- helpers -------------------------------- */

function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function direction(r: number | null): string {
  if (r === null) return "moved";
  if (Math.abs(r) < 0.005) return "held flat";
  return r > 0 ? `rose ${pct(r).replace("+", "")}` : `fell ${pct(r).replace("-", "")}`;
}

/** Difference of the rounded values, so the table is self-consistent. */
function positionDelta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  const d = Number(current.toFixed(1)) - Number(previous.toFixed(1));
  if (Math.abs(d) < 0.05) return "0.0";
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}`;
}

function num(n: number): string {
  return n.toLocaleString("en-GB");
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}
