import { GSC_LAG_DAYS, formatDate } from "@/lib/dates";

/**
 * The single most-asked question about any GSC-backed report is "why doesn't
 * this include yesterday". Answering it on every screen is cheaper than
 * answering it every week.
 */
export function DataCutoff({
  cutoff,
  className = "",
}: {
  cutoff: string;
  className?: string;
}) {
  return (
    <p className={`text-xs text-ink-muted ${className}`}>
      <span className="text-ink-secondary">
        Data complete to {formatDate(cutoff)}
      </span>{" "}
      · Search Console publishes {GSC_LAG_DAYS} days behind, so every figure
      here ends at that date
    </p>
  );
}

/**
 * Sync state for one client. A stale or failed nightly pull has to be visible —
 * silently serving three-day-old numbers as current is the failure mode that
 * costs trust.
 */
export function SyncStatus({
  /**
   * Hours since the last successful sync, computed in the data layer. Reading
   * the clock during render is impure — "how long ago" is a value the request
   * carries, not something a component goes and finds out for itself.
   */
  ageHours,
  lastSyncError,
}: {
  ageHours: number | null;
  lastSyncError?: string | null;
}) {
  if (lastSyncError) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-critical">
        <Dot className="bg-critical" />
        Last sync failed
      </span>
    );
  }

  if (ageHours === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <Dot className="bg-axis" />
        Never synced
      </span>
    );
  }

  const hours = ageHours;
  // A nightly job that has not run in a day and a half has missed a night.
  const stale = hours > 36;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${
        stale ? "text-ink-secondary" : "text-ink-muted"
      }`}
    >
      <Dot className={stale ? "bg-warning" : "bg-good"} />
      {stale ? "Sync overdue — " : "Synced "}
      {relative(hours)}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 rounded-full ${className}`}
    />
  );
}

function relative(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
