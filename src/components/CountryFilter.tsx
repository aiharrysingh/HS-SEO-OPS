"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { compact } from "@/lib/format";

export type CountryOption = {
  /** ISO-3166-1 alpha-3, lowercase. */
  code: string;
  name: string;
  clicks: number;
};

/**
 * Multi-select country filter.
 *
 * Offers only the countries this client actually has data for, biggest first —
 * a list of all 250 would bury the handful that matter for any real site.
 */
export function CountryFilter({
  options,
  selected,
  label,
}: {
  options: CountryOption[];
  selected: string[];
  /** Server-rendered summary ("All countries", "India", "3 countries"). */
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.code.includes(q),
    );
  }, [options, search]);

  // Seeded on open rather than synced from props in an effect, which would
  // cascade renders on every navigation.
  const toggleOpen = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setDraft(selected);
        setSearch("");
      }
      return !wasOpen;
    });
  };

  const apply = (codes: string[]) => {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (codes.length > 0) params.set("country", codes.join(","));
    else params.delete("country");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggleCode = (code: string) =>
    setDraft((d) =>
      d.includes(code) ? d.filter((c) => c !== code) : [...d, code],
    );

  const active = selected.length > 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          active
            ? "border-hairline bg-wash-1 text-ink"
            : "border-hairline bg-surface text-ink hover:bg-page"
        }`}
      >
        {label}
        {active && <span className="ml-1 text-ink-muted">✕</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter by country"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-hairline bg-surface text-xs shadow-sm"
        >
          <div className="border-b border-hairline p-2">
            <label className="relative block">
              <span className="sr-only">Search countries</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search countries…"
                className="w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
              />
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-3 py-4 text-center text-ink-muted">
                No countries match.
              </p>
            )}
            {visible.map((o) => (
              <label
                key={o.code}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-page"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(o.code)}
                  onChange={() => toggleCode(o.code)}
                  className="accent-series-1"
                />
                <span className="min-w-0 flex-1 truncate text-ink">{o.name}</span>
                <span className="tnum shrink-0 text-ink-muted">
                  {compact(o.clicks)}
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-hairline p-2">
            <button
              type="button"
              onClick={() => apply([])}
              className="rounded-lg px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => apply(draft)}
              className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
            >
              {draft.length > 0 ? `Apply (${draft.length})` : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
