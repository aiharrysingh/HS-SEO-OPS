import "dotenv/config";
import { loadCurrentState, loadSkill, tryLoadCurrentState } from "@/lib/references";

async function main() {
  const s = await loadCurrentState();
  console.log("verifiedAt:", s.verifiedAt, "| ageDays:", s.ageDays, "| stale:", s.stale);
  console.log("provenance:", s.provenance);
  console.log("content chars:", s.content.length);

  const skill = await loadSkill("client-report");
  console.log("\nSKILL.md body chars:", skill.body.length);
  console.log("starts:", JSON.stringify(skill.body.slice(0, 60)));
  console.log("frontmatter stripped:", !skill.body.startsWith("---"));

  // Staleness path: pretend it is 100 days later.
  const later = new Date(Date.now() + 100 * 86400000);
  const stale = await loadCurrentState(later);
  console.log("\n+100 days -> stale:", stale.stale, "|", stale.provenance.slice(0, 80) + "...");

  delete process.env.SEO_REFERENCES_DIR;
  const missing = await tryLoadCurrentState();
  console.log("\nunset SEO_REFERENCES_DIR -> ok:", missing.ok);
  if (!missing.ok) console.log("error:", missing.error.slice(0, 90) + "...");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
