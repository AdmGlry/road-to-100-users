import { AlertTriangleIcon } from "lucide-react";

import { gmailConnectHref } from "@/components/gmail/gmail-connect-card";
import { Button } from "@/components/ui/button";
import type { GmailStatus } from "@/lib/hunter/application-types";

/**
 * Compact "Reconnecte ton Gmail" banner (SPEC §6.1) for an expired or revoked
 * connection, or one missing a Gmail permission. Renders nothing otherwise.
 */
export function GmailStatusBanner({ status, next }: { status: GmailStatus; next?: string }) {
  const reason =
    status.state === "expired"
      ? "Ta connexion a expiré (Google la coupe tous les 7 jours pendant la phase de test)."
      : status.state === "revoked"
        ? "L'accès de Spontané à ton Gmail a été retiré."
        : status.state === "active" && status.missingScopes
          ? "Il manque une autorisation pour envoyer et suivre tes mails."
          : null;
  if (!reason) return null;

  return (
    <div
      role="status"
      className="border-warning/40 bg-warning-soft flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <AlertTriangleIcon className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-semibold">Reconnecte ton Gmail</p>
          <p className="text-foreground/80 text-sm">
            {reason} Tes mails validés restent en attente, rien n&apos;est perdu.
          </p>
        </div>
      </div>
      <Button asChild className="w-full shrink-0 sm:w-auto">
        <a href={gmailConnectHref(next)}>Reconnecter</a>
      </Button>
    </div>
  );
}
