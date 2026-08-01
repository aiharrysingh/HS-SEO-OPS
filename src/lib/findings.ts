import type { ReportInput, SegmentTotals } from "./reportData";
import type { AlgorithmUpdate } from "./updates";

/**
 * The diagnosis engine.
 *
 * Each rule reads the computed payload and either emits a finding with its
 * evidence attached, or stays silent. Nothing here guesses: a rule fires on a
 * threshold it can point at, and when no rule fires the report says the
 * movement is unexplained and lists what to check — which is what the
 * `client-report` standard asks for, and the one thing a confident narrator
 * reliably gets wrong.
 *
 * Rules are ordered by how much they change what the reader should do.
 */

export type Finding = {
  id: string;
  /** Headline, written as a claim. */
  title: string;
  /** The explanation, in full sentences. */
  detail: string;
  /** Bullet points of the numbers the claim rests on. */
  evidence: string[];
  /** Drives ordering and whether it lands in the summary. */
  severity: "critical" | "notable" | "context";
  /** Whether this is a confirmed reading or the best-supported guess. */
  confidence: "measured" | "likely" | "possible";
};

/** Movement below this is noise, not a story. */
const MATERIAL_CHANGE = 0.05;
/** A position move smaller than this is not a ranking change. */
const MATERIAL_POSITION = 0.5;

export function diagnose(
  input: ReportInput,
  updates: AlgorithmUpdate[],
): Finding[] {
  const findings: Finding[] = [];
  const cur = input.current;
  const prev = input.previous;

  const clickChange = ratio(cur.all.clicks, prev.all.clicks);
  const imprChange = ratio(cur.all.impressions, prev.all.impressions);
  const posChange =
    cur.all.position !== null && prev.all.position !== null
      ? cur.all.position - prev.all.position
      : null;

  /* 1. AI Overview exposure ------------------------------------------------ */
  if (input.aiOverviewCandidates.length > 0) {
    const lost = input.aiOverviewCandidates.reduce(
      (n, q) => n + (q.previousClicks - q.clicks),
      0,
    );
    findings.push({
      id: "ai-overview",
      title: `${input.aiOverviewCandidates.length} ${plural(input.aiOverviewCandidates.length, "query", "queries")} lost clicks while impressions held`,
      detail:
        "These queries kept their impressions and their ranking position but lost clicks, which means fewer people clicked a result that was shown just as often and just as high. That pattern is consistent with an AI Overview answering the query on the results page. It cannot be confirmed directly — Search Console reports AI Overview impressions only, with nothing exposed through the API — so this is the best-supported reading rather than a measured fact.",
      evidence: input.aiOverviewCandidates.slice(0, 5).map(
        (q) =>
          `“${q.query}” — clicks ${pct(q.clicksChangePct)}, impressions ${pct(q.impressionsChangePct)}, position ${signedFixed(q.positionChange, 1)}`,
      ),
      severity: lost > Math.abs(cur.all.clicks - prev.all.clicks) * 0.3 ? "critical" : "notable",
      confidence: "likely",
    });
  }

  /* 2. Algorithm update date match ----------------------------------------- */
  if (Math.abs(clickChange ?? 0) >= MATERIAL_CHANGE) {
    if (updates.length > 0) {
      findings.push({
        id: "algorithm-update",
        title: `A confirmed Google update overlaps this period`,
        detail:
          "Traffic moved materially and a confirmed update was rolling out in or shortly before the reporting window. The dates line up, which is necessary before blaming an update — but overlap is not causation, and the segment-level detail elsewhere in this report is the better guide to what actually happened.",
        evidence: updates.map(
          (u) => `${u.name} (${u.label}) — rollout ${u.start} to ${u.end}${u.notes ? `; ${u.notes}` : ""}`,
        ),
        severity: "context",
        confidence: "possible",
      });
    } else {
      findings.push({
        id: "no-algorithm-update",
        title: "No confirmed Google update overlaps this period",
        detail:
          "Traffic moved materially, but the confirmed-update timeline shows nothing rolling out in or shortly before this window. If anyone attributes this movement to an algorithm update, the dates do not support it.",
        evidence: [],
        severity: "context",
        confidence: "measured",
      });
    }
  }

  /* 3. Branded vs non-branded divergence ----------------------------------- */
  if (input.brandTermsConfigured) {
    const nb = ratio(cur.nonBranded.clicks, prev.nonBranded.clicks);
    const br = ratio(cur.branded.clicks, prev.branded.clicks);

    if (nb !== null && br !== null && Math.sign(nb) !== Math.sign(br) && (Math.abs(nb) >= MATERIAL_CHANGE || Math.abs(br) >= MATERIAL_CHANGE)) {
      const good = nb > 0;
      findings.push({
        id: "brand-divergence",
        title: good
          ? "Non-branded search grew while branded fell"
          : "Branded search grew while non-branded fell",
        detail: good
          ? "The total understates the month. Non-branded search is the half that reflects SEO work, and it is up; the decline sits in branded search, which moves with brand awareness and PR rather than with anything done to the site."
          : "The total flatters the month. Branded search is up — which follows brand activity, not SEO — while non-branded search, the half that reflects the work here, is down.",
        evidence: [
          `Non-branded: ${cur.nonBranded.clicks} clicks, ${pct(nb)} on ${prev.nonBranded.clicks}`,
          `Branded: ${cur.branded.clicks} clicks, ${pct(br)} on ${prev.branded.clicks}`,
        ],
        severity: "critical",
        confidence: "measured",
      });
    } else if (nb !== null && Math.abs(nb) >= MATERIAL_CHANGE) {
      findings.push({
        id: "non-branded-move",
        title: `Non-branded clicks ${nb > 0 ? "rose" : "fell"} ${pct(Math.abs(nb))}`,
        detail:
          "Non-branded search is the number that reflects the work, so this is the headline movement rather than the total.",
        evidence: [
          `Non-branded: ${cur.nonBranded.clicks} clicks, was ${prev.nonBranded.clicks}`,
          `Branded: ${cur.branded.clicks} clicks, was ${prev.branded.clicks}`,
        ],
        severity: "notable",
        confidence: "measured",
      });
    }
  }

  /* 4. Ranking loss vs CTR compression ------------------------------------- */
  if (clickChange !== null && clickChange <= -MATERIAL_CHANGE) {
    if (posChange !== null && posChange >= MATERIAL_POSITION) {
      findings.push({
        id: "ranking-loss",
        title: "Clicks fell because rankings fell",
        detail:
          "Average position worsened alongside the click decline. This is a ranking problem rather than a click-through problem, so the fix is in relevance, content depth or competition — not in titles and descriptions.",
        evidence: [
          `Average position ${cur.all.position?.toFixed(1)}, was ${prev.all.position?.toFixed(1)}`,
          `Clicks ${cur.all.clicks}, was ${prev.all.clicks} (${pct(clickChange)})`,
        ],
        severity: "critical",
        confidence: "measured",
      });
    } else if (
      imprChange !== null &&
      imprChange <= -MATERIAL_CHANGE &&
      (posChange === null || Math.abs(posChange) < MATERIAL_POSITION)
    ) {
      findings.push({
        id: "demand-drop",
        title: "Fewer people searched, rankings held",
        detail:
          "Impressions fell while average position stayed flat. The site is being shown as often as its ranking warrants — there was simply less searching. Check the same period last year before treating this as a problem; seasonal demand looks identical to this.",
        evidence: [
          `Impressions ${cur.all.impressions}, was ${prev.all.impressions} (${pct(imprChange)})`,
          `Average position ${cur.all.position?.toFixed(1)}, was ${prev.all.position?.toFixed(1)} — effectively unchanged`,
        ],
        severity: "notable",
        confidence: "measured",
      });
    } else if (
      imprChange !== null &&
      imprChange > -MATERIAL_CHANGE &&
      (posChange === null || Math.abs(posChange) < MATERIAL_POSITION)
    ) {
      findings.push({
        id: "ctr-compression",
        title: "Same visibility, fewer clicks",
        detail:
          "Impressions and position both held while clicks fell, so the site was shown as often and as high as before and was clicked less. Something changed on the results page rather than in the rankings — richer competitor results, more ads, or an AI answer above the listings.",
        evidence: [
          `Impressions ${cur.all.impressions}, was ${prev.all.impressions} (${pct(imprChange)})`,
          `CTR ${(cur.all.ctr * 100).toFixed(2)}%, was ${(prev.all.ctr * 100).toFixed(2)}%`,
        ],
        severity: "notable",
        confidence: "likely",
      });
    }
  }

  /* 5. Seasonality ---------------------------------------------------------- */
  if (input.yearAgo && clickChange !== null && Math.abs(clickChange) >= MATERIAL_CHANGE) {
    const yoy = ratio(cur.all.clicks, input.yearAgo.all.clicks);
    if (yoy !== null && Math.sign(yoy) !== Math.sign(clickChange) && Math.abs(yoy) >= MATERIAL_CHANGE) {
      findings.push({
        id: "seasonal",
        title: `Down on last period but ${yoy > 0 ? "up" : "down"} ${pct(Math.abs(yoy))} year on year`,
        detail:
          "The period-on-period direction and the year-on-year direction disagree, which is the signature of a seasonal cycle rather than a change in performance. Judge this period against the same period last year, not against last month.",
        evidence: [
          `This period: ${cur.all.clicks} clicks`,
          `Same period last year: ${input.yearAgo.all.clicks} clicks (${pct(yoy)})`,
        ],
        severity: "notable",
        confidence: "measured",
      });
    }
  }

  /* 6. Concentration — one page or the whole site? -------------------------- */
  const totalDelta = cur.all.clicks - prev.all.clicks;
  if (Math.abs(totalDelta) > 0 && clickChange !== null && Math.abs(clickChange) >= MATERIAL_CHANGE) {
    const movers = totalDelta < 0 ? input.fallingPages : input.risingPages;
    const top = movers[0];
    if (top && Math.abs(top.change) >= Math.abs(totalDelta) * 0.5) {
      findings.push({
        id: "concentrated",
        title: `Most of the movement is one page`,
        detail: `${top.path} accounts for the majority of the change on its own. This is a page-level issue, not a site-wide one — which usually makes it far cheaper to fix.`,
        evidence: [
          `${top.path}: ${signed(top.change)} clicks (${top.previousClicks} → ${top.clicks})`,
          `Whole site: ${signed(totalDelta)} clicks`,
        ],
        severity: "notable",
        confidence: "measured",
      });
    }
  }

  /* 6b. A page moved materially even though the site total did not ----------- */
  {
    // Gated on the page, not on the site. A big single-page drop inside a flat
    // total is the most easily missed thing in any report — the headline says
    // nothing happened, so nobody looks further.
    const floor = Math.max(20, prev.all.clicks * 0.03);
    const worst = input.fallingPages.find((p) => Math.abs(p.change) >= floor && p.clicks > 0);
    const best = input.risingPages.find((p) => p.change >= floor);
    const alreadyCovered = findings.some((f) => f.id === "concentrated" || f.id === "zeroed");

    if (!alreadyCovered && (worst || best)) {
      const evidence: string[] = [];
      if (worst)
        evidence.push(
          `${worst.path}: ${signed(worst.change)} clicks (${worst.previousClicks} → ${worst.clicks}${worst.position !== null ? `, position ${worst.position.toFixed(1)}` : ""})`,
        );
      if (best)
        evidence.push(
          `${best.path}: ${signed(best.change)} clicks (${best.previousClicks} → ${best.clicks})`,
        );

      findings.push({
        id: "page-movement",
        title: worst
          ? `${worst.path} lost ${Math.abs(worst.change)} clicks`
          : `${best!.path} gained ${best!.change} clicks`,
        detail:
          clickChange !== null && Math.abs(clickChange) < MATERIAL_CHANGE
            ? "The site total barely moved, but individual pages did. Movement at page level is worth acting on even when it cancels out in the headline."
            : "Individual pages moved more than the site average, which is where the effort is best spent.",
        evidence,
        severity: "notable",
        confidence: "measured",
      });
    }
  }

  /* 6c. Year-on-year worth stating ------------------------------------------ */
  if (input.yearAgo) {
    const yoy = ratio(cur.all.clicks, input.yearAgo.all.clicks);
    const alreadySeasonal = findings.some((f) => f.id === "seasonal");
    if (!alreadySeasonal && yoy !== null && Math.abs(yoy) >= 0.15) {
      findings.push({
        id: "year-on-year",
        title: `${pct(yoy)} on the same period last year`,
        detail:
          yoy > 0
            ? "The year-on-year direction is the one that matters for judging whether the work is compounding; week-to-week noise is not. On that measure the site is well ahead of where it was."
            : "The site is behind where it was a year ago. That is the comparison worth acting on, whatever the shorter-term movement shows.",
        evidence: [
          `This period: ${cur.all.clicks} clicks`,
          `Same period last year: ${input.yearAgo.all.clicks} clicks`,
        ],
        severity: "context",
        confidence: "measured",
      });
    }
  }

  /* 7. Pages that went to zero ---------------------------------------------- */
  const wentToZero = input.fallingPages.filter(
    (p) => p.clicks === 0 && p.previousClicks >= 10,
  );
  if (wentToZero.length > 0) {
    findings.push({
      id: "zeroed",
      title: `${wentToZero.length} ${plural(wentToZero.length, "page", "pages")} dropped to zero clicks`,
      detail:
        "A page that was earning clicks and now earns none is usually a technical fault rather than a ranking slide — deindexed, redirected, noindexed, or returning an error. Worth checking directly before anything else in this report.",
      evidence: wentToZero
        .slice(0, 5)
        .map((p) => `${p.path} — was ${p.previousClicks} clicks, now 0`),
      severity: "critical",
      confidence: "measured",
    });
  }

  /* 8. New content still maturing ------------------------------------------- */
  if (input.publishedInPeriod.length > 0) {
    findings.push({
      id: "new-content",
      title: `${input.publishedInPeriod.length} ${plural(input.publishedInPeriod.length, "page", "pages")} published this period`,
      detail:
        "New pages take months to reach their level — expect very little from them in their first weeks. They are noted here so their absence from the numbers is not mistaken for a problem.",
      evidence: input.publishedInPeriod.map(
        (p) => `${p.publishedAt} — ${p.title}`,
      ),
      severity: "context",
      confidence: "measured",
    });
  }

  /* 9. Nothing moved --------------------------------------------------------- */
  if (clickChange !== null && Math.abs(clickChange) < MATERIAL_CHANGE) {
    // A flat total is only "no story" when nothing else fired. When a rule has
    // already found something, the flat total is the thing hiding it — and
    // saying "no story here" underneath that finding would contradict it.
    const somethingFired = findings.some((f) => f.severity !== "context");
    findings.push({
      id: "flat",
      title: somethingFired
        ? "The total was flat, which hides the movement above"
        : "The period was flat",
      detail: somethingFired
        ? "Total clicks moved less than 5%, so at headline level this looks like an uneventful period. It isn't — the movement described above is real and offset by gains elsewhere. Judge the period on the segments, not the total."
        : "Clicks moved less than 5%, which is inside normal week-to-week variation. Some periods are flat, particularly early on; there is no story here and manufacturing one would only be contradicted next period.",
      evidence: [
        `Clicks ${cur.all.clicks}, was ${prev.all.clicks} (${pct(clickChange)})`,
      ],
      severity: "context",
      confidence: "measured",
    });
  }

  /* 10. Unexplained ---------------------------------------------------------- */
  const explained = findings.some(
    (f) => f.severity === "critical" || f.severity === "notable",
  );
  if (!explained && clickChange !== null && Math.abs(clickChange) >= MATERIAL_CHANGE) {
    findings.push({
      id: "unexplained",
      title: `Clicks moved ${pct(clickChange)} and the data does not explain why`,
      detail:
        "None of the usual causes fit: rankings, impressions and click-through all moved together rather than one leading the others, and no single page dominates. Rather than guess, here is what to check next.",
      evidence: [
        "Search Console coverage and manual actions for anything site-wide",
        "Whether tracking or the property configuration changed mid-period",
        "Any redesign, migration or template change in the period",
        "Competitor movement on the top non-branded queries",
      ],
      severity: "notable",
      confidence: "measured",
    });
  }

  const rank = { critical: 0, notable: 1, context: 2 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ------------------------------- helpers -------------------------------- */

/** Fractional change, or null when there is no baseline to divide by. */
function ratio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export function pct(r: number | null): string {
  if (r === null) return "n/a";
  const v = r * 100;
  return `${v > 0 ? "+" : ""}${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function signedFixed(n: number, dp: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export type { SegmentTotals };
