"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type RangePreset = { days: number; label: string };

/**
 * Date range control: presets for the common cases, plus an explicit
 * from/to for everything else.
 *
 * Native `<input type="date">` rather than a calendar library — it brings
 * keyboard support, locale formatting and mobile pickers for free, and this
 * app has no other UI dependency worth adding one for. `max` is pinned to the
 * data cutoff so the GSC lag rule is enforced in the control itself, not just
 * corrected server-side after the fact.
 */
export function DateRangePicker({
  window,
  cutoff,
  presets,
  activePreset,
}: {
  window: { start: string; end: string };
  /** Latest selectable day — `dataCutoff()`, computed on the server. */
  cutoff: string;
  presets: readonly RangePreset[];
  /** Which preset (if any) the current window exactly matches. */
  activePreset: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(window.start);
  const [to, setTo] = useState(window.end);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — the two things a user expects of
  // any popover, and neither comes for free without a dialog library.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const applyPreset = (days: number) => {
    setOpen(false);
    // Presets are trailing windows, so drop the explicit range and let the
    // server recompute from `days` — keeps shared URLs meaningful.
    push({ days: String(days), from: null, to: null });
  };

  const applyCustom = () => {
    if (!from || !to) return;
    setOpen(false);
    push({ from, to, days: null });
  };

  // Seeding on open rather than syncing from props in an effect: the inputs
  // only need to match the applied window at the moment the panel appears,
  // and an effect for it would cascade renders on every navigation.
  const toggle = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setFrom(window.start);
        setTo(window.end);
      }
      return !wasOpen;
    });
  };

  const isCustom = activePreset === null;

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <div className="inline-flex rounded-lg border border-hairline bg-page p-0.5">
        {presets.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => applyPreset(p.days)}
            aria-pressed={activePreset === p.days}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              activePreset === p.days
                ? "bg-surface font-medium text-ink shadow-sm"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            isCustom
              ? "bg-surface font-medium text-ink shadow-sm"
              : "text-ink-secondary hover:text-ink"
          }`}
        >
          {isCustom ? `${window.start} → ${window.end}` : "Custom"}
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose a date range"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-hairline bg-surface px-3 py-3 text-xs shadow-sm"
        >
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2">
              <span className="text-ink-secondary">From</span>
              <input
                type="date"
                value={from}
                max={to || cutoff}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-ink-secondary">To</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                max={cutoff}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
          </div>

          <p className="mt-2 leading-snug text-ink-muted">
            Search Console publishes about three days behind, so {cutoff} is the
            latest day with settled data.
          </p>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!from || !to}
              className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
