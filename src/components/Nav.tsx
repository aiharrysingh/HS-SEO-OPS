"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

export type NavClient = { id: string; name: string; domain: string };

/**
 * The sections of a client, in the order the work actually happens: look at
 * what happened, decide what to write, check the site, check the numbers,
 * send the report.
 *
 * These used to be buttons crowded into the page header, which meant the only
 * way to discover a section was to already be on a client screen and read a
 * row of ten controls. Putting them in the sidebar is how every tool in this
 * category is laid out, and it makes the section you are in obvious.
 */
const CLIENT_SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "content", label: "Content plan" },
  { segment: "review", label: "Draft review" },
  { segment: "audits", label: "Site audit" },
  { segment: "analytics", label: "Analytics" },
  { segment: "reports", label: "Reports" },
] as const;

export function ClientNav({ clients }: { clients: NavClient[] }) {
  const pathname = usePathname();

  // Keep whatever range/country filter is applied when moving between a
  // client's sections — losing it on every click made the filters feel broken.
  const search = useSearchParams();
  const qs = search.toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  const activeClient = clients.find((c) =>
    pathname.startsWith(`/clients/${c.id}`),
  );

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      <NavItem href={withQs("/")} label="Portfolio" active={pathname === "/"} />

      {activeClient && (
        <div className="mt-4">
          <div className="px-3 pb-1">
            <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {activeClient.name}
            </div>
          </div>
          {CLIENT_SECTIONS.map((s) => {
            const href = s.segment
              ? `/clients/${activeClient.id}/${s.segment}`
              : `/clients/${activeClient.id}`;
            const active = s.segment
              ? pathname.startsWith(href)
              : pathname === `/clients/${activeClient.id}`;
            return (
              <NavItem
                key={s.segment || "overview"}
                href={withQs(href)}
                label={s.label}
                active={active}
                nested
              />
            );
          })}
        </div>
      )}

      <div className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {activeClient ? "Switch client" : "Clients"}
      </div>

      {clients.length === 0 && (
        <p className="px-3 py-2 text-xs text-ink-muted">
          No clients yet — add one from{" "}
          <Link href="/account" className="underline">
            Account
          </Link>
          .
        </p>
      )}

      {clients
        .filter((c) => c.id !== activeClient?.id)
        .map((c) => (
          <NavItem
            key={c.id}
            href={withQs(`/clients/${c.id}`)}
            label={c.name}
            sublabel={c.domain}
            active={false}
          />
        ))}

      <div className="mt-5">
        <NavItem
          href="/account"
          label="Account"
          active={pathname.startsWith("/account")}
        />
      </div>
    </nav>
  );
}

function NavItem({
  href,
  label,
  sublabel,
  active,
  nested = false,
}: {
  href: string;
  label: string;
  sublabel?: string;
  active: boolean;
  /** Indented, for a client's sections under its name. */
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg py-2 text-sm transition-colors ${
        nested ? "pl-5 pr-3" : "px-3"
      } ${
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

export type NavUser = { email: string; name: string | null; picture: string | null };

/** Signed-in identity plus sign-out. `compact` drops the label for the mobile strip. */
export function UserMenu({ user, compact = false }: { user: NavUser; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1">
      {user.picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Google avatar, not worth next/image's remote-pattern config for one small icon
        <img
          src={user.picture}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 shrink-0 rounded-full"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash-1 text-[11px] font-medium text-ink-secondary">
          {(user.name ?? user.email)[0]?.toUpperCase()}
        </span>
      )}
      {!compact && (
        <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
          {user.name ?? user.email}
        </span>
      )}
      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="rounded-lg border border-hairline px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-page hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </div>
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
