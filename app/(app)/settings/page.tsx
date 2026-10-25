import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { GmailConnectCard, gmailResultMessage } from "@/components/gmail/gmail-connect-card";
import { GmailDisconnectButton } from "@/components/gmail/gmail-disconnect-button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getGmailStatus } from "@/lib/google/connection";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Paramètres · Spontané" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paramètres</h1>

      <section aria-labelledby="settings-gmail" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="settings-gmail" className="text-lg font-semibold">
            Connexion Gmail
          </h2>
          <p className="text-muted-foreground max-w-[65ch] text-sm">
            Tes candidatures partent de ton adresse Gmail, et Spontané suit les réponses pour toi.
          </p>
        </div>
        {/* Session + search params are request data: streamed behind Suspense. */}
        <Suspense fallback={<GmailSkeleton />}>
          <GmailSection searchParams={searchParams} />
        </Suspense>
      </section>

      <section
        aria-labelledby="settings-data"
        className="bg-card flex flex-col gap-2 rounded-xl border border-dashed p-4 sm:p-6"
      >
        <h2 id="settings-data" className="text-lg font-semibold">
          Tes données
        </h2>
        <p className="text-muted-foreground max-w-[65ch] text-sm leading-relaxed">
          L&apos;export de tes données et la suppression de ton compte arrivent dans une prochaine
          version. Supprimer ton compte effacera ton profil, ton CV, tes mails et ta connexion
          Gmail.
        </p>
      </section>
    </div>
  );
}

async function GmailSection({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const [status, params] = await Promise.all([
    createClient().then((supabase) => getGmailStatus(supabase)),
    searchParams,
  ]);
  const result = gmailResultMessage(params);
  const canDisconnect = status.state === "active" || status.state === "expired" || status.state === "revoked";

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={
            result.kind === "error"
              ? "border-destructive/40 text-destructive rounded-md border p-3 text-sm"
              : "bg-success-soft text-success rounded-md p-3 text-sm font-semibold"
          }
        >
          {result.text}
        </p>
      )}
      <GmailConnectCard status={status} next="/settings" />
      {canDisconnect && <GmailDisconnectButton />}
    </div>
  );
}

function GmailSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Chargement de ta connexion Gmail…
      </p>
      <div className="bg-muted h-40 animate-pulse rounded-xl" aria-hidden="true" />
    </div>
  );
}
