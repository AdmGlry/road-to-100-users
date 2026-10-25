"use client";

import {
  AlertCircleIcon,
  CircleIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import {
  dismissFailedLeadAction,
  getReviewStateAction,
  startPreparationAction,
} from "@/app/(app)/hunter/review/actions";
import { preparationProgress } from "@/components/review/review-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PreparingLead, ReviewState } from "@/lib/hunter/application-types";

/**
 * Preparation queue (SPEC §7.4: "traitement en file, statut visible à
 * l'écran"): progress of the batch, companies waiting / in progress, and
 * failed ones with "Réessayer" / "Retirer".
 */
export function PreparationProgress({
  state,
  offline,
  onState,
  onAnnounce,
}: {
  state: ReviewState;
  offline: boolean;
  onState: (state: ReviewState | null) => void;
  onAnnounce: (message: string) => void;
}) {
  const active = state.preparing.filter(
    (p) => p.prep_status === "queued" || p.prep_status === "running",
  );
  const failed = state.preparing.filter((p) => p.prep_status === "failed");
  const { ready, total, percent } = preparationProgress(state);

  if (active.length === 0 && failed.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 && (
        <Card aria-busy="true" className="gap-4">
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">Préparation de tes mails</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div
                role="progressbar"
                aria-label="Avancement de la préparation"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={ready}
                aria-valuetext={`${ready} mail${ready > 1 ? "s" : ""} prêt${ready > 1 ? "s" : ""} sur ${total}`}
                className="bg-muted h-2 w-full overflow-hidden rounded-full"
              >
                <div
                  className="bg-primary h-full w-full origin-left transition-[scale] duration-(--duration-slow) ease-(--ease-out)"
                  style={{ scale: `${percent / 100} 1` }}
                />
              </div>
              <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
                {ready} mail{ready > 1 ? "s" : ""} prêt{ready > 1 ? "s" : ""} sur {total}
              </p>
            </div>
            <ul className="flex flex-col gap-2.5 text-sm">
              {active.map((lead) => (
                <li key={lead.leadId} className="flex items-start gap-3">
                  {lead.prep_status === "running" ? (
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="text-primary mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <CircleIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="min-w-0 wrap-anywhere">
                    <span className="font-medium" translate="no">
                      {lead.companyName}
                    </span>
                    <span className="text-muted-foreground">
                      {lead.prep_status === "running"
                        ? " : recherche du contact et rédaction…"
                        : " : en attente"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {offline && (
              <p className="text-muted-foreground text-xs">
                Connexion instable : on réessaie automatiquement.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Chaque mail prend environ 30 secondes à 1 minute. Tu peux relire les premiers pendant
              que les suivants se préparent. Si tu quittes la page, la préparation reprendra à ton
              retour.
            </p>
          </CardContent>
        </Card>
      )}

      {failed.length > 0 && (
        <Card className="border-destructive/40 gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircleIcon aria-hidden="true" className="text-destructive size-5" />
              <h2 className="text-lg">
                {failed.length > 1
                  ? `${failed.length} mails n'ont pas pu être préparés`
                  : "Un mail n'a pas pu être préparé"}
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {failed.map((lead) => (
                <FailedLead
                  key={lead.leadId}
                  lead={lead}
                  onState={onState}
                  onAnnounce={onAnnounce}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FailedLead({
  lead,
  onState,
  onAnnounce,
}: {
  lead: PreparingLead;
  onState: (state: ReviewState | null) => void;
  onAnnounce: (message: string) => void;
}) {
  const [pending, setPending] = useState<"retry" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setPending("retry");
    setError(null);
    try {
      const result = await startPreparationAction([lead.leadId]);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.queued === 0) {
        setError("Cette entreprise ne peut plus être préparée. Retire-la de la liste.");
        return;
      }
      const fresh = await getReviewStateAction();
      onState(fresh.ok ? fresh.state : null);
      onAnnounce(`Nouvelle tentative pour ${lead.companyName}.`);
    } catch {
      setError("Connexion perdue : réessaie dans un instant.");
    } finally {
      setPending(null);
    }
  };

  const dismiss = async () => {
    setPending("dismiss");
    setError(null);
    try {
      const result = await dismissFailedLeadAction(lead.leadId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onState(result.state);
      onAnnounce(`${lead.companyName} retirée.`);
    } catch {
      setError("Connexion perdue : réessaie dans un instant.");
    } finally {
      setPending(null);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm wrap-anywhere">
        <span className="font-medium" translate="no">
          {lead.companyName}
        </span>
        {lead.prep_error ? ` : ${lead.prep_error}` : " : la préparation a échoué."}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          className="w-full sm:w-fit"
          disabled={pending !== null}
          onClick={() => void retry()}
          aria-label={`Réessayer la préparation pour ${lead.companyName}`}
        >
          {pending === "retry" ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <RotateCwIcon aria-hidden="true" />
          )}
          Réessayer
        </Button>
        <Button
          variant="ghost"
          className="w-full sm:w-fit"
          disabled={pending !== null}
          onClick={() => void dismiss()}
          aria-label={`Retirer ${lead.companyName} de la liste`}
        >
          {pending === "dismiss" ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <XIcon aria-hidden="true" />
          )}
          Retirer
        </Button>
      </div>
    </li>
  );
}
