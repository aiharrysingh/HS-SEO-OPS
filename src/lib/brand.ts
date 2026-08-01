/**
 * Branded vs non-branded query classification.
 *
 * The `client-report` skill is blunt about why this matters: "a branded surge
 * from a PR hit is not SEO working", and non-branded is "the number that
 * reflects the work". A flat total with non-branded up and branded down is a
 * good month misreported as a flat one.
 *
 * Classification happens here, at read time, rather than being stored on the
 * row at sync. Brand term lists get refined — someone notices a misspelling
 * that's been landing in non-branded for months — and when they do, every past
 * report should correct itself rather than only future ones.
 */

/**
 * Strips case, punctuation and spacing so "north wind hotels",
 * "Northwind Hotels" and "northwind-hotels" all collapse to one form.
 * Spacing is removed rather than normalised because searchers routinely split
 * or join a brand name, and both spellings are equally branded.
 */
export function normaliseQuery(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining accents so "café" matches "cafe".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Words too generic to identify a brand on their own. */
const STOPWORDS = new Set([
  "the",
  "and",
  "hotels",
  "hotel",
  "legal",
  "group",
  "ltd",
  "limited",
  "co",
  "com",
  "uk",
  "org",
  "net",
]);

/**
 * A starting brand term list derived from the client's name and domain.
 *
 * Deliberately conservative: the full name, and the domain's second-level label.
 * Individual words are only included when they're distinctive enough to stand
 * alone — "Kestrel" identifies a brand, "Legal" matches half the market.
 * Treat the result as a first draft for a human to extend.
 */
export function deriveBrandTerms(name: string, domain: string): string[] {
  const terms = new Set<string>();

  terms.add(name);

  const label = domain.replace(/^www\./, "").split(".")[0];
  if (label) terms.add(label);

  for (const word of name.split(/[\s&]+/)) {
    const clean = word.replace(/[^A-Za-z0-9]/g, "");
    if (clean.length >= 5 && !STOPWORDS.has(clean.toLowerCase())) {
      terms.add(clean);
    }
  }

  return [...terms].filter((t) => normaliseQuery(t).length >= 3);
}

/**
 * Prepared matcher. Building the normalised term list once and reusing it
 * across a period's worth of queries keeps the hot path cheap.
 */
export function brandMatcher(brandTerms: string[]) {
  const needles = brandTerms
    .map(normaliseQuery)
    .filter((t) => t.length >= 3)
    // Longest first so a `startsWith` scan isn't order-dependent.
    .sort((a, b) => b.length - a.length);

  return {
    /** No terms configured means nothing can be called branded — say so, don't guess. */
    configured: needles.length > 0,
    isBranded(query: string): boolean {
      if (needles.length === 0) return false;
      const q = normaliseQuery(query);
      return needles.some((n) => q.includes(n));
    },
  };
}

export type BrandSplit<T> = { branded: T; nonBranded: T };
