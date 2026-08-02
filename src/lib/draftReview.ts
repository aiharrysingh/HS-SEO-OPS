/**
 * Phase 5 — content review, implementing the `draft-auditor` standard as rules
 * rather than prompts (plan §4, Decision C).
 *
 * The standard covers four things. Three are mechanical and are implemented
 * here: AI writing tells, on-page SEO, and citation readiness. The fourth —
 * *"does this say anything the top-ranking pages don't already say"* — is a
 * judgement about the rest of the internet, and the standard itself calls it
 * "the one that matters most". A rule engine cannot answer it, so this does
 * not pretend to: it is reported as a question for the reviewer rather than
 * silently dropped, which is the same move `findings.ts` makes with
 * "unexplained".
 *
 * The standard's other warning is heeded too: *"Manufacturing findings to
 * justify the review is a habit worth avoiding."* A clean draft returns a
 * short, clean result.
 */

export type ReviewSeverity = "critical" | "warning" | "info" | "pass";

export type ReviewFinding = {
  id: string;
  section: "ai-tells" | "seo" | "citation";
  title: string;
  detail: string;
  evidence: string[];
  severity: ReviewSeverity;
};

export type DraftReview = {
  verdict: "ship" | "ship-after-fixes" | "needs-rewrite";
  verdictReason: string;
  aiTellLevel: "low" | "moderate" | "heavy";
  words: number;
  readingMinutes: number;
  findings: ReviewFinding[];
  /** Stated, not silently omitted — see the module comment. */
  notAutomated: string[];
};

/* ------------------------------ vocabulary ------------------------------- */

/** The standard's list, verbatim. Density is what matters, not instances. */
const TELL_WORDS = [
  "delve", "leverage", "robust", "seamless", "landscape", "realm", "testament",
  "pivotal", "crucial", "navigate", "foster", "harness", "tapestry", "unlock",
  "elevate", "embark",
];

const INFLATED = [
  "stands as a testament",
  "plays a vital role",
  "underscores the importance",
  "plays a crucial role",
  "it is important to note",
  "in today's fast-paced",
  "ever-evolving",
];

const VAGUE_ATTRIBUTION = [
  "experts say",
  "studies show",
  "research shows",
  "it is widely regarded",
  "it's widely regarded",
  "many believe",
  "some argue",
  "it is often said",
];

const HEDGES = [
  "may or may not",
  "it depends",
  "time will tell",
  "only time will tell",
  "remains to be seen",
  "there is no one-size-fits-all",
];

/* -------------------------------- helpers -------------------------------- */

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>]/g, "");
}

function countAll(haystack: string, needles: string[]): { term: string; n: number }[] {
  const lower = haystack.toLowerCase();
  return needles
    .map((term) => ({
      term,
      n: lower.split(term.toLowerCase()).length - 1,
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}

type Heading = { level: number; text: string; index: number };

function headings(md: string): Heading[] {
  const out: Heading[] = [];
  const lines = md.split(/\r?\n/);
  let index = 0;
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), index });
    index += line.length + 1;
  }
  return out;
}

/* -------------------------------- review --------------------------------- */

export function reviewDraft(input: {
  markdown: string;
  targetKeyword?: string;
  title?: string;
  metaDescription?: string;
}): DraftReview {
  const md = input.markdown;
  const plain = stripMarkdown(md);
  const words = plain.split(/\s+/).filter(Boolean).length;
  const hs = headings(md);
  const keyword = input.targetKeyword?.trim().toLowerCase() ?? "";
  const findings: ReviewFinding[] = [];

  const paragraphs = md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p));

  /* --- 1. AI writing tells --------------------------------------------- */

  let tellScore = 0;

  const vocab = countAll(plain, TELL_WORDS);
  const vocabTotal = vocab.reduce((a, v) => a + v.n, 0);
  const per1000 = words > 0 ? (vocabTotal / words) * 1000 : 0;
  /**
   * Density *and* an absolute floor.
   *
   * Density alone is meaningless on a short draft — one "leverage" in 112
   * words scores 8.9 per 1,000 and would be reported as a critical problem,
   * which is precisely the "one 'crucial' is fine" case the standard says not
   * to flag. Four separate occurrences is the point at which it stops being
   * word choice and starts being a pattern.
   */
  if (vocabTotal >= 4 && per1000 >= 2) {
    const heavy = vocabTotal >= 8 && per1000 >= 4;
    tellScore += heavy ? 2 : 1;
    findings.push({
      id: "tell-vocabulary",
      section: "ai-tells",
      title: `Loaded vocabulary appears ${vocabTotal} times (${per1000.toFixed(1)} per 1,000 words)`,
      detail:
        "These words aren't wrong individually, but this density is the most " +
        "recognisable signature of generated prose. Replace most of them with " +
        "the plainer word you'd have used out loud.",
      evidence: vocab.slice(0, 6).map((v) => `${v.n}× "${v.term}"`),
      severity: heavy ? "critical" : "warning",
    });
  }

  const negParallel: string[] = [
    ...(plain.match(
      /\b(?:it'?s|this is|that'?s)\s+not\s+(?:just\s+)?[^.,;]{2,40}[,—-]\s*it'?s\b/gi,
    ) ?? []),
    ...(plain.match(
      /\bnot\s+(?:just\s+)?about\s+[^.,;]{2,40}[—-]\s*it'?s\s+about\b/gi,
    ) ?? []),
  ];
  if (negParallel.length >= 2) {
    tellScore += 1;
    findings.push({
      id: "tell-negative-parallelism",
      section: "ai-tells",
      title: `"It's not X, it's Y" used ${negParallel.length} times`,
      detail:
        "A signature construction. Once is a rhetorical choice; repeated, it's " +
        "the strongest structural tell after the rule of three.",
      evidence: negParallel.slice(0, 3).map((s) => s.trim().slice(0, 90)),
      severity: "warning",
    });
  }

  const inflated = countAll(plain, INFLATED);
  if (inflated.length > 0) {
    tellScore += 1;
    findings.push({
      id: "tell-inflated",
      section: "ai-tells",
      title: "Inflated significance phrases",
      detail:
        "These announce importance instead of demonstrating it. Cut them and " +
        "state the thing itself.",
      evidence: inflated.map((v) => `${v.n}× "${v.term}"`),
      severity: "warning",
    });
  }

  const vague = countAll(plain, VAGUE_ATTRIBUTION);
  if (vague.length > 0) {
    tellScore += 1;
    findings.push({
      id: "tell-vague-attribution",
      section: "ai-tells",
      title: "Claims attributed to nobody",
      detail:
        "Either name the source and link it, or drop the claim. Unsourced " +
        "authority is both an AI tell and a credibility problem.",
      evidence: vague.map((v) => `${v.n}× "${v.term}"`),
      severity: "warning",
    });
  }

  const ingClauses = (plain.match(/,\s+(?:highlighting|underscoring|showcasing|emphasising|emphasizing|reflecting|demonstrating|ensuring)\b/gi) ?? []);
  if (ingClauses.length >= 3) {
    tellScore += 1;
    findings.push({
      id: "tell-ing-clauses",
      section: "ai-tells",
      title: `${ingClauses.length} trailing "-ing" clauses that restate rather than add`,
      detail:
        'Clauses like ", highlighting the need for a robust strategy" repeat the ' +
        "sentence they're attached to. Delete them; nothing is lost.",
      evidence: [...new Set(ingClauses.map((s) => s.trim()))].slice(0, 5),
      severity: "warning",
    });
  }

  const emDashes = (md.match(/—/g) ?? []).length;
  if (words > 0 && (emDashes / words) * 1000 >= 4) {
    tellScore += 1;
    findings.push({
      id: "tell-em-dashes",
      section: "ai-tells",
      title: `${emDashes} em dashes in ${words} words`,
      detail:
        "Used as a default connector rather than for effect. Vary with full " +
        "stops, commas and colons.",
      evidence: [`${((emDashes / words) * 1000).toFixed(1)} per 1,000 words`],
      severity: "info",
    });
  }

  // Uniform paragraph length — human writing varies, generated text often doesn't.
  if (paragraphs.length >= 5) {
    const lens = paragraphs.map((p) => p.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(
      lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length,
    );
    const cv = mean > 0 ? sd / mean : 1;
    if (cv < 0.35 && mean > 25) {
      tellScore += 1;
      findings.push({
        id: "tell-uniform-paragraphs",
        section: "ai-tells",
        title: "Paragraphs are unusually uniform in length",
        detail:
          "Human writing varies its rhythm — a one-line paragraph after a long " +
          "one lands. This piece runs at a near-constant length throughout.",
        evidence: [
          `${paragraphs.length} paragraphs, mean ${mean.toFixed(0)} words, variation ${(cv * 100).toFixed(0)}%`,
        ],
        severity: "info",
      });
    }
  }

  const hedges = countAll(plain, HEDGES);
  if (hedges.length > 0) {
    findings.push({
      id: "tell-hedged-conclusion",
      section: "ai-tells",
      title: "Hedged conclusion",
      detail:
        "Phrases that decline to say anything. If the piece has a position, state it.",
      evidence: hedges.map((v) => `${v.n}× "${v.term}"`),
      severity: "info",
    });
  }

  const aiTellLevel: DraftReview["aiTellLevel"] =
    tellScore >= 4 ? "heavy" : tellScore >= 2 ? "moderate" : "low";

  /* --- 2. On-page SEO --------------------------------------------------- */

  const h1s = hs.filter((h) => h.level === 1);
  if (h1s.length !== 1) {
    findings.push({
      id: "seo-h1",
      section: "seo",
      title: h1s.length === 0 ? "No H1" : `${h1s.length} H1s`,
      detail: "Exactly one H1, describing what the page is actually about.",
      evidence: h1s.map((h) => h.text).slice(0, 4),
      severity: "warning",
    });
  }

  // Skipped heading levels (H2 → H4).
  const skipped: string[] = [];
  for (let i = 1; i < hs.length; i++) {
    if (hs[i].level - hs[i - 1].level > 1) {
      skipped.push(`H${hs[i - 1].level} "${hs[i - 1].text}" → H${hs[i].level} "${hs[i].text}"`);
    }
  }
  if (skipped.length > 0) {
    findings.push({
      id: "seo-heading-hierarchy",
      section: "seo",
      title: "Heading levels are skipped",
      detail: "Going straight from H2 to H4 breaks the document outline.",
      evidence: skipped.slice(0, 4),
      severity: "warning",
    });
  }

  if (input.title) {
    const len = input.title.length;
    if (len < 40 || len > 65) {
      findings.push({
        id: "seo-title-length",
        section: "seo",
        title: `Title is ${len} characters`,
        detail: "Aim for roughly 50–60 so it isn't truncated in results.",
        evidence: [input.title],
        severity: "warning",
      });
    }
    if (keyword && !input.title.toLowerCase().includes(keyword)) {
      findings.push({
        id: "seo-title-keyword",
        section: "seo",
        title: "Target keyword isn't in the title",
        detail: `Expected "${input.targetKeyword}" to appear, ideally near the start.`,
        evidence: [input.title],
        severity: "warning",
      });
    }
  }

  if (input.metaDescription) {
    const len = input.metaDescription.length;
    if (len < 120 || len > 165) {
      findings.push({
        id: "seo-meta-length",
        section: "seo",
        title: `Meta description is ${len} characters`,
        detail: "Aim for roughly 140–160, with a reason to click.",
        evidence: [input.metaDescription.slice(0, 120)],
        severity: "info",
      });
    }
  }

  if (keyword) {
    const first100 = plain.split(/\s+/).slice(0, 100).join(" ").toLowerCase();
    if (!first100.includes(keyword)) {
      findings.push({
        id: "seo-keyword-opening",
        section: "seo",
        title: "Target keyword isn't in the first 100 words",
        detail:
          "Both readers and engines use the opening to decide what the page is about.",
        evidence: [`Looking for "${input.targetKeyword}"`],
        severity: "warning",
      });
    }
    const inH2 = hs.some(
      (h) => h.level >= 2 && h.text.toLowerCase().includes(keyword),
    );
    if (!inH2 && hs.length > 1) {
      findings.push({
        id: "seo-keyword-heading",
        section: "seo",
        title: "Target keyword isn't in any subheading",
        detail: "At least one H2 should address the term directly.",
        evidence: hs.filter((h) => h.level >= 2).slice(0, 4).map((h) => h.text),
        severity: "info",
      });
    }
    // Stuffing, from the other direction. Same floor as the vocabulary check:
    // on a short draft a two-word keyword used twice already trips a 3%
    // density, which is normal writing rather than stuffing.
    const occurrences = plain.toLowerCase().split(keyword).length - 1;
    const density = words > 0 ? (occurrences * keyword.split(/\s+/).length) / words : 0;
    if (occurrences >= 5 && density > 0.03) {
      findings.push({
        id: "seo-keyword-stuffing",
        section: "seo",
        title: `Target keyword appears ${occurrences} times (${(density * 100).toFixed(1)}% density)`,
        detail:
          "Past roughly 3% it reads badly to a human and does nothing for rankings.",
        evidence: [`"${input.targetKeyword}" × ${occurrences} in ${words} words`],
        severity: "warning",
      });
    }
  }

  const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  const genericAnchors = links.filter((m) =>
    /^(click here|here|read more|learn more|this)$/i.test(m[1].trim()),
  );
  if (genericAnchors.length > 0) {
    findings.push({
      id: "seo-anchor-text",
      section: "seo",
      title: `${genericAnchors.length} uninformative link${genericAnchors.length === 1 ? "" : "s"}`,
      detail: 'Anchor text should describe the destination, not say "click here".',
      evidence: genericAnchors.slice(0, 4).map((m) => `"${m[1]}" → ${m[2]}`),
      severity: "info",
    });
  }
  if (links.length === 0 && words > 400) {
    findings.push({
      id: "seo-no-links",
      section: "seo",
      title: "No links at all",
      detail:
        "A piece this long should point somewhere — internally for context, " +
        "externally for anything it claims as fact.",
      evidence: [`${words} words, 0 links`],
      severity: "warning",
    });
  }

  const images = [...md.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)];
  const noAlt = images.filter((m) => m[1].trim().length === 0);
  if (noAlt.length > 0) {
    findings.push({
      id: "seo-image-alt",
      section: "seo",
      title: `${noAlt.length} image${noAlt.length === 1 ? "" : "s"} without alt text`,
      detail: "Alt text is an accessibility requirement before it is an SEO one.",
      evidence: [`${noAlt.length} of ${images.length} images`],
      severity: "warning",
    });
  }

  /* --- 3. AI-citation readiness ----------------------------------------- */

  // Does each section answer its own heading early enough to be extracted?
  const slowSections: string[] = [];
  const subheads = hs.filter((h) => h.level >= 2);
  for (let i = 0; i < subheads.length; i++) {
    const start = subheads[i].index + subheads[i].text.length;
    const end = i + 1 < subheads.length ? subheads[i + 1].index : md.length;
    const body = stripMarkdown(md.slice(start, end)).trim();
    const bodyWords = body.split(/\s+/).filter(Boolean).length;
    /**
     * Only long sections are worth testing this way.
     *
     * Matching heading words against the opening is a crude proxy for "does
     * this answer its own heading" — a section headed "Where the time actually
     * went" that opens "Profiling showed 78% was in the embedding call" answers
     * it perfectly while sharing no words. On a short section that produces
     * pure noise, so the check only runs where a genuine preamble could hide.
     */
    if (bodyWords >= 120) {
      const opening = body.split(/\s+/).slice(0, 60).join(" ").toLowerCase();
      const headWords = subheads[i].text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);
      const hit = headWords.some((w) => opening.includes(w));
      if (!hit && headWords.length > 0) slowSections.push(subheads[i].text);
    }
  }
  if (slowSections.length > 0) {
    findings.push({
      id: "citation-slow-sections",
      section: "citation",
      title: `${slowSections.length} section${slowSections.length === 1 ? " doesn't" : "s don't"} answer their heading up front`,
      detail:
        "An engine lifting an answer takes the first 40–60 words under a " +
        "heading. If the answer arrives after a preamble, the section isn't " +
        "quotable.",
      evidence: slowSections.slice(0, 5),
      severity: "warning",
    });
  }

  const numbers = (plain.match(/\b\d[\d,.]*\s?(?:%|percent|million|billion|k\b)?/gi) ?? []).length;
  if (words > 300 && numbers < 3) {
    findings.push({
      id: "citation-no-specifics",
      section: "citation",
      title: "Almost no specific figures",
      detail:
        "Engines cite concrete, checkable claims. Generalities are exactly what " +
        "already exists everywhere else.",
      evidence: [`${numbers} numeric references in ${words} words`],
      severity: "warning",
    });
  }

  /* --- verdict ---------------------------------------------------------- */

  const criticals = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  let verdict: DraftReview["verdict"];
  let verdictReason: string;
  if (criticals > 0 || aiTellLevel === "heavy") {
    verdict = "needs-rewrite";
    verdictReason =
      aiTellLevel === "heavy"
        ? "The AI tells are dense enough that editing around them won't fix it."
        : "There are problems here that a pass of edits won't cover.";
  } else if (warnings >= 3) {
    verdict = "ship-after-fixes";
    verdictReason = `${warnings} things worth fixing first, none of them structural.`;
  } else if (findings.length === 0) {
    verdict = "ship";
    verdictReason = "Nothing flagged by the automated checks.";
  } else {
    verdict = "ship-after-fixes";
    verdictReason = "A small number of fixes, then it's fine.";
  }

  return {
    verdict,
    verdictReason,
    aiTellLevel,
    words,
    readingMinutes: Math.max(1, Math.round(words / 230)),
    findings,
    notAutomated: [
      "Substance — whether this says anything the pages already ranking don't. " +
        "The standard calls this the check that matters most, and it needs a " +
        "human who has read the competition.",
      "Voice — whether the patterns above are AI tells or simply how this " +
        "author writes. Some people write in threes naturally.",
      "Factual accuracy of any claim made in the draft.",
    ],
  };
}
