"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const NEW_CLIENT = "__new__";

/** A reasonable client name/domain guess from a GSC siteUrl, so the fields aren't blank. */
function guessFromSiteUrl(siteUrl: string): { name: string; domain: string } {
  const domain = siteUrl.startsWith("sc-domain:")
    ? siteUrl.slice("sc-domain:".length)
    : (() => {
        try {
          return new URL(siteUrl).hostname;
        } catch {
          return siteUrl;
        }
      })();
  const label = domain.replace(/^www\./, "").split(".")[0];
  const name = label ? label[0].toUpperCase() + label.slice(1) : domain;
  return { name, domain };
}

export function LinkPropertyForm({
  siteUrl,
  clients,
}: {
  siteUrl: string;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selection, setSelection] = useState("");
  const guess = guessFromSiteUrl(siteUrl);
  const [newName, setNewName] = useState(guess.name);
  const [newDomain, setNewDomain] = useState(guess.domain);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function linkExisting() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${selection}/gsc-property`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gscProperty: siteUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not link property.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function createAndLink() {
    if (!newName.trim() || !newDomain.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, domain: newDomain, gscProperty: siteUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not create client.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        className="rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink"
        aria-label={`Link ${siteUrl} to a client`}
      >
        <option value="">Link to client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW_CLIENT}>+ New client</option>
      </select>

      {selection && selection !== NEW_CLIENT && (
        <button
          type="button"
          onClick={linkExisting}
          disabled={pending}
          className="rounded-lg border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
        >
          {pending ? "Linking…" : "Link"}
        </button>
      )}

      {selection === NEW_CLIENT && (
        <>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client name"
            className="w-32 rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink"
          />
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Domain"
            className="w-40 rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink"
          />
          <button
            type="button"
            onClick={createAndLink}
            disabled={pending || !newName.trim() || !newDomain.trim()}
            className="rounded-lg border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create client"}
          </button>
        </>
      )}

      {error && <span className="text-xs text-critical">{error}</span>}
    </div>
  );
}
