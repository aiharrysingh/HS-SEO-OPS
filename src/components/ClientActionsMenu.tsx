"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The occasional client actions, behind one control.
 *
 * The client header had ten things competing for attention — filters, six
 * navigation buttons and four action buttons — which made the frequently-used
 * ones (the filters, and Sync) hard to find. Navigation moved to the sidebar;
 * these are the setup jobs you do once or rarely, so they collapse to a menu
 * rather than sitting permanently on screen.
 */
export function ClientActionsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
      >
        Manage
        <span aria-hidden="true" className="ml-1 text-ink-muted">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-hairline bg-surface p-2 shadow-sm"
        >
          <p className="px-2 pb-2 text-[11px] uppercase tracking-wide text-ink-muted">
            Set up &amp; maintain
          </p>
          <div className="flex flex-col items-stretch gap-1.5 [&_button]:w-full [&_button]:justify-start [&>div]:w-full">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
