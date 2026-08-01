import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import {
  delta,
  formatDelta,
  formatDeltaPlaces,
  isImprovement,
  type Delta,
} from "@/lib/format";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-hairline bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Signed change against a named baseline.
 *
 * Carries an arrow and a value as well as colour — a red number alone is not a
 * readable signal for a colourblind reader.
 *
 * `unit="places"` switches to rank semantics: the value is places rather than
 * percent, and the arrow tracks *improvement* rather than the raw number. A
 * page moving from position 9.6 to 9.1 reads "↑ 0.5 places", which is how the
 * move is described out loud, even though the number went down.
 */
export function DeltaBadge({
  d,
  lowerIsBetter = false,
  unit = "percent",
  className = "",
}: {
  d: Delta;
  lowerIsBetter?: boolean;
  unit?: "percent" | "places";
  className?: string;
}) {
  const good = isImprovement(d, lowerIsBetter);
  const tone =
    good === null
      ? "text-ink-muted"
      : good
        ? "text-good-text"
        : "text-critical";

  const arrow =
    d.direction === "flat"
      ? "→"
      : unit === "places"
        ? good
          ? "↑"
          : "↓"
        : d.direction === "up"
          ? "↑"
          : "↓";

  return (
    <span
      className={`tnum inline-flex items-center gap-0.5 text-xs font-medium ${tone} ${className}`}
      title={
        unit === "places" && good !== null
          ? good
            ? "Moved up the search results"
            : "Moved down the search results"
          : undefined
      }
    >
      <span aria-hidden="true">{arrow}</span>
      {unit === "places" ? formatDeltaPlaces(d) : formatDelta(d)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  current,
  previous,
  lowerIsBetter = false,
  unit = "percent",
  spark,
  comparisonLabel,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  lowerIsBetter?: boolean;
  unit?: "percent" | "places";
  spark?: number[];
  comparisonLabel?: string;
}) {
  const d =
    current !== undefined && previous !== undefined
      ? delta(current, previous)
      : null;

  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <div className="text-xs font-medium text-ink-secondary">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        {/* Proportional figures: tabular-nums makes display numbers look loose. */}
        <div className="text-2xl font-semibold leading-none text-ink">
          {value}
        </div>
        {spark && spark.length > 1 && (
          <Sparkline values={spark} title={`${label} trend`} />
        )}
      </div>
      {d && (
        <div className="mt-2 flex items-center gap-1.5">
          <DeltaBadge d={d} lowerIsBetter={lowerIsBetter} unit={unit} />
          <span className="text-xs text-ink-muted">
            {comparisonLabel ?? "vs previous period"}
          </span>
        </div>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "good" | "warning" | "critical";
}) {
  const tones = {
    neutral: "bg-page text-ink-secondary border-hairline",
    blue: "bg-wash-1 text-ink-secondary border-hairline",
    good: "bg-wash-good text-good-text border-hairline",
    warning: "bg-wash-warning text-ink-secondary border-hairline",
    critical: "bg-wash-critical text-critical border-hairline",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-secondary">
          {children}
        </div>
      )}
    </div>
  );
}
