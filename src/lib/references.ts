import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Loads the Cowork skill files at runtime.
 *
 * Plan §4's non-negotiable: the app must not hard-code volatile SEO facts into
 * prompts. `current-state.md` is loaded from disk, dated, and if it goes stale
 * the app says so in its output. The same file the `client-report` skill reads
 * is the file the app reads — that is what stops the two drifting apart.
 *
 * `SEO_REFERENCES_DIR` points at the unzipped skills folder, e.g.
 *   .../HS-Marketing Stack
 * containing `client-report/SKILL.md` and
 * `client-report/references/current-state.md`.
 */

/** The file declares its own rule: "more than 60 days old" means re-verify. */
const STALE_AFTER_DAYS = 60;

export class ReferencesUnavailableError extends Error {}

export type CurrentState = {
  content: string;
  /** Parsed from the `**Last verified: YYYY-MM-DD**` header, null if absent. */
  verifiedAt: string | null;
  ageDays: number | null;
  stale: boolean;
  /** One line stating provenance and age, for the top of a generated report. */
  provenance: string;
};

export type SkillDoc = {
  /** SKILL.md with its YAML frontmatter stripped. */
  body: string;
  name: string;
};

type CacheEntry<T> = { mtimeMs: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

function referencesDir(): string {
  const dir = process.env.SEO_REFERENCES_DIR;
  if (!dir) {
    throw new ReferencesUnavailableError(
      "SEO_REFERENCES_DIR is not set. Point it at the unzipped skills folder " +
        "(the one containing client-report/) so the app and Cowork read the " +
        "same SEO facts. Refusing to generate from hard-coded facts.",
    );
  }
  return dir;
}

/** Reads a file, caching on mtime — these are read on every generation. */
async function readCached<T>(
  file: string,
  parse: (raw: string) => T,
): Promise<T> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    throw new ReferencesUnavailableError(
      `Expected to find ${path.basename(file)} at ${file}. Check ` +
        "SEO_REFERENCES_DIR points at the unzipped skills folder.",
    );
  }

  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;

  const value = parse(await readFile(file, "utf8"));
  cache.set(file, { mtimeMs, value });
  return value;
}

function daysSince(iso: string, now: Date): number {
  return Math.floor(
    (now.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

export async function loadCurrentState(
  now: Date = new Date(),
): Promise<CurrentState> {
  const file = path.join(
    referencesDir(),
    "client-report",
    "references",
    "current-state.md",
  );

  const content = await readCached(file, (raw) => raw);

  const match = content.match(/Last verified:\s*(\d{4}-\d{2}-\d{2})/i);
  const verifiedAt = match ? match[1] : null;
  const ageDays = verifiedAt ? daysSince(verifiedAt, now) : null;
  const stale = ageDays === null || ageDays > STALE_AFTER_DAYS;

  const provenance = verifiedAt
    ? stale
      ? `SEO reference facts last verified ${verifiedAt} (${ageDays} days ago) — ` +
        `past the ${STALE_AFTER_DAYS}-day re-verify threshold. Treat any ` +
        `claim about algorithm updates, AI features or rich results as ` +
        `needing a check before this goes to the client.`
      : `SEO reference facts verified ${verifiedAt} (${ageDays} days ago).`
    : "SEO reference facts carry no verification date — treat them as unverified.";

  return { content, verifiedAt, ageDays, stale, provenance };
}

/**
 * Loads a skill's SKILL.md and strips the YAML frontmatter.
 *
 * The frontmatter is routing metadata for Cowork ("use this skill when…") and
 * is noise in a system prompt; the body is the actual standard.
 */
export async function loadSkill(name: string): Promise<SkillDoc> {
  const file = path.join(referencesDir(), name, "SKILL.md");
  const body = await readCached(file, (raw) =>
    raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim(),
  );
  return { body, name };
}

/** Whether generation can run at all, without throwing. */
export function referencesConfigured(): boolean {
  return Boolean(process.env.SEO_REFERENCES_DIR);
}

/** Non-throwing variant for UI that wants to show state rather than fail. */
export async function tryLoadCurrentState(): Promise<
  { ok: true; state: CurrentState } | { ok: false; error: string }
> {
  try {
    return { ok: true, state: await loadCurrentState() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
