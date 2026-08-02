import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Client sign-in.
 *
 * There is no self-service request form because there is no mail provider
 * wired up — a link that silently never arrives is worse than telling someone
 * who to ask. The team generates the link from the client's screen and sends
 * it however they already communicate.
 */
export default async function PortalLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user?.role === "client") redirect("/portal");
  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-6">
        <h1 className="text-lg font-semibold text-ink">Client access</h1>
        <p className="mt-2 text-sm leading-snug text-ink-secondary">
          Your reports and search performance are reached through a private
          link sent to you by your account manager.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-wash-critical px-3 py-2 text-xs leading-snug text-critical">
            {error}
          </p>
        )}

        <p className="mt-4 rounded-lg bg-page px-3 py-2 text-xs leading-snug text-ink-secondary">
          Lost the link, or has it expired? Reply to your usual contact and
          they&apos;ll send a fresh one.
        </p>
      </div>
    </div>
  );
}
