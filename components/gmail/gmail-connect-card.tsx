import { CheckIcon, ChevronDownIcon, MailIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GmailStatus } from "@/lib/hunter/application-types";

/** Link that starts the Gmail OAuth flow and comes back to `next`. */
export function gmailConnectHref(next?: string): string {
  return next
    ? `/api/google/oauth/start?next=${encodeURIComponent(next)}`
    : "/api/google/oauth/start";
}

const RESULT_MESSAGES: Record<string, string> = {
  access_denied: "Tu as annulé la connexion à Gmail. Rien n'a été enregistré.",
  state: "Ce lien de connexion a expiré ou vient d'un autre onglet. Relance la connexion ici.",
  missing_code: "Google n'a pas pu finaliser la connexion. Réessaie dans un instant.",
  exchange: "Google n'a pas pu finaliser la connexion. Réessaie dans un instant.",
  scopes:
    "Il faut cocher les deux autorisations demandées (envoyer des mails et lire les réponses). Relance la connexion en les cochant.",
  save: "La connexion n'a pas pu être enregistrée. Réessaie dans un instant.",
  not_configured: "La connexion Gmail n'est pas encore disponible sur ce serveur.",
};

/**
 * Message to show after the OAuth callback redirect
 * (`?gmail=connected` or `?gmail=error&reason=…`), or null.
 */
export function gmailResultMessage(params: {
  gmail?: string | string[];
  reason?: string | string[];
}): { kind: "success" | "error"; text: string } | null {
  const gmail = Array.isArray(params.gmail) ? params.gmail[0] : params.gmail;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  if (gmail === "connected") {
    return {
      kind: "success",
      text: "Gmail est connecté. Tes candidatures partiront de ton adresse.",
    };
  }
  if (gmail === "error") {
    return {
      kind: "error",
      text: (reason && RESULT_MESSAGES[reason]) || "La connexion à Gmail a échoué. Réessaie.",
    };
  }
  return null;
}

function Consent() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Ce que Spontané fait avec ton Gmail</h3>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <CheckIcon className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Envoyer les candidatures que tu as validées, depuis ton adresse. Elles apparaissent
              dans tes « Messages envoyés », comme si tu les avais écrites toi-même.
            </span>
          </li>
          <li className="flex gap-2">
            <CheckIcon className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Lire uniquement les réponses aux mails envoyés par Spontané, pour suivre tes
              candidatures à ta place.
            </span>
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Ce qu&apos;on ne fait jamais</h3>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <XIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Lire le reste de ta boîte mail ou faire des recherches dedans.</span>
          </li>
          <li className="flex gap-2">
            <XIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Envoyer un mail que tu n&apos;as pas relu et validé.</span>
          </li>
          <li className="flex gap-2">
            <XIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Supprimer ou modifier tes mails.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function TestModeNote() {
  return (
    <div className="text-muted-foreground flex max-w-[65ch] flex-col gap-1 text-sm">
      <p>
        Spontané est en phase de test : Google te demandera de reconnecter ton Gmail tous les
        7&nbsp;jours. Un bandeau te le rappellera.
      </p>
      <p>
        Google affichera aussi un avertissement « application non validée » : c&apos;est normal
        pendant cette phase. Coche bien les deux autorisations demandées.
      </p>
      <p>Tu peux déconnecter Gmail à tout moment depuis les paramètres.</p>
    </div>
  );
}

/**
 * Gmail connection card with the consent explanation (SPEC §2.3, §6.2).
 * Server-renderable (no client state): the connect button is a plain link to
 * the OAuth start route.
 */
export function GmailConnectCard({ status, next }: { status: GmailStatus; next?: string }) {
  const href = gmailConnectHref(next);

  if (status.state === "not_configured") {
    return (
      <section
        aria-labelledby="gmail-card-title"
        className="bg-card flex flex-col gap-2 rounded-xl border border-dashed p-4 sm:p-6"
      >
        <h2 id="gmail-card-title" className="text-base font-semibold">
          Connexion Gmail bientôt disponible
        </h2>
        <p className="text-muted-foreground max-w-[65ch] text-sm">
          L&apos;envoi depuis Gmail n&apos;est pas encore activé sur ce serveur. Tes mails restent
          enregistrés : tu pourras les envoyer dès que la connexion sera ouverte.
        </p>
      </section>
    );
  }

  const connectedOk = status.state === "active" && !status.missingScopes;
  if (connectedOk) {
    return (
      <section
        aria-labelledby="gmail-card-title"
        className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-6"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 id="gmail-card-title" className="text-base font-semibold">
                Gmail
              </h2>
              <Badge variant="success">Connecté</Badge>
            </div>
            {status.email && (
              <p className="text-muted-foreground text-sm wrap-anywhere" translate="no">
                {status.email}
              </p>
            )}
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a href={href}>Reconnecter</a>
          </Button>
        </div>
        <details className="group">
          <summary className="text-primary inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            Ce que Spontané peut faire avec ton Gmail
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-[rotate] duration-(--duration-base) ease-(--ease-out) group-open:rotate-180"
            />
          </summary>
          <div className="flex flex-col gap-4 pt-2">
            <Consent />
            <TestModeNote />
          </div>
        </details>
      </section>
    );
  }

  const problem =
    status.state === "expired"
      ? {
          title: "Ta connexion Gmail a expiré",
          text: "Pendant la phase de test, Google coupe l'accès au bout de 7\u00a0jours. Reconnecte ton Gmail pour reprendre les envois et le suivi des réponses.",
          cta: "Reconnecter mon Gmail",
        }
      : status.state === "revoked"
        ? {
            title: "L'accès à ton Gmail a été retiré",
            text: "Spontané ne peut plus envoyer ni suivre tes candidatures. Reconnecte ton Gmail pour reprendre.",
            cta: "Reconnecter mon Gmail",
          }
        : status.state === "active"
          ? {
              title: "Il manque une autorisation Gmail",
              text: "Pour envoyer tes candidatures et suivre les réponses, coche les deux autorisations demandées par Google.",
              cta: "Reconnecter mon Gmail",
            }
          : null;

  return (
    <section
      aria-labelledby="gmail-card-title"
      className={
        problem
          ? "border-warning/40 bg-card flex flex-col gap-5 rounded-xl border p-4 sm:p-6"
          : "bg-card flex flex-col gap-5 rounded-xl border p-4 sm:p-6"
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <span
            className={
              problem
                ? "bg-warning-soft text-warning flex size-10 shrink-0 items-center justify-center rounded-md"
                : "bg-secondary text-secondary-foreground flex size-10 shrink-0 items-center justify-center rounded-md"
            }
            aria-hidden="true"
          >
            <MailIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="gmail-card-title" className="text-base font-semibold">
              {problem ? problem.title : "Connecte ton Gmail pour envoyer tes candidatures"}
            </h2>
            <p className="text-muted-foreground max-w-[65ch] text-sm">
              {problem
                ? problem.text
                : "Tes mails partent de ta propre adresse : les recruteurs te répondent directement, et Spontané repère leurs réponses pour toi."}
            </p>
            {problem && status.email && (
              <p className="text-muted-foreground text-sm wrap-anywhere" translate="no">
                {status.email}
              </p>
            )}
          </div>
        </div>
      </div>
      <Consent />
      <TestModeNote />
      <Button asChild className="w-full sm:w-fit">
        <a href={href}>{problem ? problem.cta : "Connecter mon Gmail"}</a>
      </Button>
    </section>
  );
}
