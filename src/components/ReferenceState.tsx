import type { CurrentState } from "@/lib/references";

/**
 * Plan §4's non-negotiable, made visible.
 *
 * The app loads volatile SEO facts from a dated file at runtime. When that file
 * goes stale — or isn't reachable at all — it has to say so where someone will
 * see it, not degrade quietly into whatever the model remembers.
 */
export function ReferenceState({
  refs,
}: {
  refs: { ok: true; state: CurrentState } | { ok: false; error: string };
}) {
  if (!refs.ok) {
    return (
      <Notice tone="critical" title="SEO reference facts unavailable">
        <p className="font-mono text-[11px] leading-snug">{refs.error}</p>
        <p className="mt-1">
          Generation is blocked until this is fixed. That is deliberate — the
          alternative is writing client deliverables from facts nobody has
          checked.
        </p>
      </Notice>
    );
  }

  if (refs.state.stale) {
    return (
      <Notice tone="warning" title="SEO reference facts are out of date">
        <p>{refs.state.provenance}</p>
        <p className="mt-1">
          Reports generated now carry the same warning in their own text, and the
          algorithm-update date matching will be missing anything recent.
          Re-verify <code className="font-mono">current-state.md</code> before
          anything goes to a client.
        </p>
      </Notice>
    );
  }

  return (
    <p className="text-xs text-ink-muted">
      <span className="text-ink-secondary">{refs.state.provenance}</span> Loaded
      at runtime from the shared skill files, so the app and Cowork stay in step.
    </p>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warning" | "critical";
  title: string;
  children: React.ReactNode;
}) {
  const bg = tone === "critical" ? "bg-wash-critical" : "bg-wash-warning";
  const text = tone === "critical" ? "text-critical" : "text-ink";
  return (
    <div className={`rounded-xl border border-hairline ${bg} px-4 py-3`}>
      <p className={`text-sm font-medium ${text}`}>{title}</p>
      <div className="mt-0.5 text-xs text-ink-secondary">{children}</div>
    </div>
  );
}
