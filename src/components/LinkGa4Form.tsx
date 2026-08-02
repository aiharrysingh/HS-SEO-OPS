"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Assigns a discovered GA4 property to an existing client. */
export function LinkGa4Form({
  propertyName,
  clients,
}: {
  propertyName: string;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (clients.length === 0) return null;

  async function link() {
    if (!clientId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/ga4-property`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ga4PropertyId: propertyName }),
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

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="rounded-lg border border-hairline bg-page px-2 py-1 text-xs text-ink"
        aria-label={`Link ${propertyName} to a client`}
      >
        <option value="">Link to client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={link}
        disabled={!clientId || pending}
        className="rounded-lg border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
      >
        {pending ? "Linking…" : "Link"}
      </button>
      {error && <span className="text-xs text-critical">{error}</span>}
    </div>
  );
}
