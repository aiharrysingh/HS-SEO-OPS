"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

export type NavClient = { id: string; name: string; domain: string };

export function ClientNav({ clients }: { clients: NavClient[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Clients">
      <NavItem href="/" label="Portfolio" active={pathname === "/"} />

      <div className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Clients
      </div>

      {clients.length === 0 && (
        <p className="px-3 py-2 text-xs text-ink-muted">
          No clients yet. Run <code className="font-mono">npm run db:seed</code>.
        </p>
      )}

      {clients.map((c) => (
        <NavItem
          key={c.id}
          href={`/clients/${c.id}`}
          label={c.name}
          sublabel={c.domain}
          active={pathname.startsWith(`/clients/${c.id}`)}
        />
      ))}
    </nav>
  );
}

function NavItem({
  href,
  label,
  sublabel,
  active,
}: {
  href: string;
  label: string;
  sublabel?: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-wash-1 font-medium text-ink"
          : "text-ink-secondary hover:bg-page hover:text-ink"
      }`}
    >
      <span className="block truncate">{label}</span>
      {sublabel && (
        <span className="block truncate text-[11px] text-ink-muted">
          {sublabel}
        </span>
      )}
    </Link>
  );
}

const THEME_EVENT = "hs-theme-change";

/**
 * The active theme lives in the DOM (set before first paint by the inline
 * script in the root layout), not in React state. Reading it through
 * useSyncExternalStore is what lets the server render a stable label and the
 * client correct it during hydration without a mismatch or a cascading render.
 */
function useTheme(): "light" | "dark" | null {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(THEME_EVENT, onChange);
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
      return () => {
        window.removeEventListener(THEME_EVENT, onChange);
        mq.removeEventListener("change", onChange);
      };
    },
    () => {
      const stamped = document.documentElement.dataset.theme;
      if (stamped === "light" || stamped === "dark") return stamped;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    },
    () => null,
  );
}

export function ThemeToggle() {
  const theme = useTheme();

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg border border-hairline px-2.5 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink"
      aria-label="Toggle light and dark theme"
    >
      {theme === "dark" ? "Light" : "Dark"} mode
    </button>
  );
}
