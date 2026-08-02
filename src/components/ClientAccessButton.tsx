"use client";

import { useState } from "react";

/**
 * Issues a client portal link.
 *
 * The link is shown for the team member to copy and send, because no mail
 * provider is configured. Saying so plainly beats a "sent!" toast for an email
 * that never goes anywhere.
 */
export function ClientAccessButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setEmail("");
        setLink(null);
        setError(null);
        setCopied(false);
      }
      return !wasOpen;
    });
  };

  async function create() {
    if (!email.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create access.");
      setLink(body.link);
      setExpiresInDays(body.expiresInDays);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
      >
        Client access
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Create client access"
          className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-hairline bg-surface px-3 py-3 text-xs shadow-sm"
        >
          {!link ? (
            <>
              <label className="block">
                <span className="text-ink-secondary">Client email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@theircompany.com"
                  className="mt-1 w-full rounded-lg border border-hairline bg-page px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series-1"
                />
              </label>
              <p className="mt-2 leading-snug text-ink-muted">
                Creates a read-only account that can see this client&apos;s
                performance and published reports — nothing else.
              </p>
              {error && <p className="mt-2 leading-snug text-critical">{error}</p>}
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
                  onClick={create}
                  disabled={pending || !email.trim()}
                  className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page disabled:opacity-60"
                >
                  {pending ? "Creating…" : "Create link"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="leading-snug text-ink-secondary">
                Send this link to {email}. It works for {expiresInDays} days and
                signs them straight in.
              </p>
              <textarea
                readOnly
                value={link}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full resize-none rounded-lg border border-hairline bg-page px-2 py-1.5 font-mono text-[11px] text-ink"
              />
              <p className="mt-1.5 leading-snug text-ink-muted">
                No email is sent — there&apos;s no mail provider configured, so
                send it however you normally talk to them.
              </p>
              {error && <p className="mt-2 leading-snug text-critical">{error}</p>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
