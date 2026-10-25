"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { disconnectGmailAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

/** Disconnect Gmail with an explicit confirmation step. */
export function GmailDisconnectButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const disconnect = () => {
    setError(null);
    startTransition(async () => {
      const result = await disconnectGmailAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConfirming(false);
      router.replace("/settings");
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-fit"
          onClick={() => setConfirming(true)}
        >
          Déconnecter Gmail
        </Button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby="gmail-disconnect-title"
      className="border-destructive/40 flex flex-col gap-3 rounded-xl border p-4"
    >
      <p id="gmail-disconnect-title" className="font-semibold">
        Déconnecter ton Gmail ?
      </p>
      <p className="text-muted-foreground max-w-[65ch] text-sm">
        Spontané perdra l&apos;accès à ton Gmail : plus aucun envoi, et le suivi des réponses
        s&apos;arrête. Les mails en file d&apos;attente restent validés mais ne partiront pas. Tu
        pourras reconnecter Gmail quand tu veux.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="destructive" onClick={disconnect} disabled={pending}>
          {pending ? "Déconnexion…" : "Oui, déconnecter"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Annuler
        </Button>
      </div>
    </div>
  );
}
