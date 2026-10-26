"use client";

import {
  AlertCircleIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  MapPinIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { moveCardAction, reviseBouncedAction } from "@/app/(app)/tracker/actions";
import { FollowupPanel } from "@/components/tracker/followup-panel";
import { StatusChip } from "@/components/tracker/tracker-card";
import {
  classificationLabel,
  classificationTone,
  columnLabel,
  fullDate,
  relativeTime,
} from "@/components/tracker/tracker-utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { GmailStatus } from "@/lib/hunter/application-types";
import {
  TRACKER_COLUMNS,
  type TrackerCard,
  type TrackerColumn,
  type TrackerState,
} from "@/lib/tracker/types";

const CONNECTION_LOST = "Connexion perdue : ton changement n'a pas été enregistré. Réessaie.";

/**
 * Detail of one application (SPEC §8.4) in a modal dialog: native
 * `<dialog>` + showModal() (focus kept inside, Escape closes, the page
 * behind is inert); the caller restores the focus on the card.
 */
export function CardDetailDialog({
  card,
  gmail,
  now,
  onClose,
  onState,
  onAnnounce,
}: {
  card: TrackerCard;
  gmail: GmailStatus;
  now: number;
  onClose: () => void;
  onState: (state: TrackerState) => void;
  onAnnounce: (message: string) => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const reviseRef = useRef<HTMLButtonElement>(null);
  const reviseCancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const [target, setTarget] = useState<TrackerColumn>(card.column);
  const [pending, setPending] = useState<"move" | "revise" | null>(null);
  const [childBusy, setChildBusy] = useState(false);
  const [confirmRevise, setConfirmRevise] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null || childBusy;
  const bounced = card.status === "bounced";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    }
    return () => dialog?.close();
  }, []);

  const move = async () => {
    if (target === card.column && !bounced) return;
    setPending("move");
    setError(null);
    try {
      const result = await moveCardAction(card.applicationId, target);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onState(result.state);
      onAnnounce(`${card.company.name} déplacée vers « ${columnLabel(target)} ».`);
    } catch {
      setError(CONNECTION_LOST);
    } finally {
      setPending(null);
    }
  };

  const revise = async () => {
    setPending("revise");
    setError(null);
    try {
      const result = await reviseBouncedAction(card.applicationId);
      if (!result.ok) {
        setError(result.message);
        setPending(null);
        return;
      }
      onAnnounce(`Le mail pour ${card.company.name} est revenu en relecture.`);
      router.push("/hunter/review");
    } catch {
      setError(CONNECTION_LOST);
      setPending(null);
    }
  };

  const sentAt = fullDate(card.sent_at);
  const moveDisabled = busy || (target === card.column && !bounced);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="motion-dialog bg-background text-foreground dark:bg-card m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-2xl rounded-xl border p-0 shadow-[0_16px_48px_-12px_rgb(23_27_52/0.35)] backdrop:bg-[rgb(15_18_38/0.55)] dark:backdrop:bg-black/75"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id={titleId}
              className="text-lg leading-snug font-semibold wrap-anywhere"
              translate="no"
              dir="auto"
            >
              {card.company.name}
            </h2>
            <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
              {card.company.city && (
                <li className="flex min-w-0 items-start gap-1.5">
                  <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 wrap-anywhere">{card.company.city}</span>
                </li>
              )}
              {card.contact && (
                <li className="flex min-w-0 items-start gap-1.5">
                  <UserRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 wrap-anywhere" translate="no">
                    {card.contact.name ? `${card.contact.name}, ` : ""}
                    {card.contact.email}
                  </span>
                </li>
              )}
            </ul>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusChip tone={bounced ? "danger" : "info"}>
                <span className="sr-only">Colonne : </span>
                {bounced ? "Adresse invalide" : columnLabel(card.column)}
              </StatusChip>
              {card.status_set_manually && (
                <span className="text-muted-foreground text-xs">Déplacée par toi</span>
              )}
            </p>
          </div>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-2 shrink-0"
            aria-label="Fermer le détail"
            onClick={onClose}
            disabled={busy}
          >
            <XIcon aria-hidden="true" className="size-5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {error && (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
            >
              <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 wrap-anywhere">{error}</span>
            </p>
          )}

          {bounced && (
            <section
              aria-label="Adresse invalide"
              className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-3"
            >
              <p className="text-sm">
                Ce mail n&apos;a pas pu être remis : l&apos;adresse
                {card.contact ? (
                  <>
                    {" "}
                    <span className="font-medium wrap-anywhere" translate="no">
                      {card.contact.email}
                    </span>
                  </>
                ) : null}{" "}
                n&apos;existe pas. Choisis un autre contact : le mail revient en relecture, tu le
                valideras à nouveau avant qu&apos;il reparte.
              </p>
              {confirmRevise ? (
                <div className="bg-muted flex flex-col gap-3 rounded-md p-3" role="group">
                  <p className="text-sm">
                    Le mail quitte le suivi et revient dans « Relecture et envoi », sans
                    destinataire. Rien ne part sans ta validation.
                  </p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      ref={reviseCancelRef}
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmRevise(false);
                        requestAnimationFrame(() => reviseRef.current?.focus());
                      }}
                    >
                      Annuler
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => void revise()}>
                      {pending === "revise" && (
                        <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                      )}
                      Revenir en relecture
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  ref={reviseRef}
                  type="button"
                  className="w-full sm:w-fit"
                  disabled={busy}
                  onClick={() => {
                    setConfirmRevise(true);
                    requestAnimationFrame(() => reviseCancelRef.current?.focus());
                  }}
                >
                  Choisir un autre contact
                </Button>
              )}
            </section>
          )}

          <FollowupPanel
            key={`${card.followup?.status ?? "none"}-${card.followup?.subject ?? ""}-${card.followup?.body.length ?? 0}`}
            card={card}
            gmail={gmail}
            now={now}
            onState={onState}
            onAnnounce={onAnnounce}
            onBusyChange={setChildBusy}
          />

          <section aria-labelledby={`${uid}-replies`} className="flex flex-col gap-2">
            <h3 id={`${uid}-replies`} className="text-base font-semibold">
              {card.replies.length > 1 ? `Réponses (${card.replies.length})` : "Réponse"}
            </h3>
            {card.replies.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Pas encore de réponse. On vérifie ta boîte Gmail toutes les heures.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {card.replies.map((reply) => (
                  <li
                    key={reply.id}
                    className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip tone={classificationTone(reply.classification)}>
                        {classificationLabel(reply.classification)}
                      </StatusChip>
                      <span
                        className="text-muted-foreground text-xs"
                        title={fullDate(reply.received_at) ?? undefined}
                      >
                        Reçue {relativeTime(reply.received_at, now)}
                      </span>
                    </div>
                    {reply.from_email && (
                      <p className="text-muted-foreground text-xs wrap-anywhere" translate="no">
                        De : {reply.from_email}
                      </p>
                    )}
                    {reply.snippet && (
                      <p className="text-sm wrap-anywhere" dir="auto">
                        « {reply.snippet} »
                      </p>
                    )}
                    {reply.suggested_action && (
                      <p className="bg-muted rounded-md px-2.5 py-2 text-sm">
                        <span className="font-semibold">Conseil : </span>
                        {reply.suggested_action}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${uid}-mail`} className="flex flex-col gap-2">
            <h3 id={`${uid}-mail`} className="text-base font-semibold">
              Mail envoyé
            </h3>
            {sentAt && <p className="text-muted-foreground text-xs">Envoyé le {sentAt}</p>}
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="text-sm font-semibold wrap-anywhere">
                {card.subject || "(sans objet)"}
              </p>
              <p className="text-sm wrap-anywhere whitespace-pre-wrap">{card.body}</p>
            </div>
            {card.gmailUrl && (
              <Button asChild variant="outline" className="w-full sm:w-fit">
                <a href={card.gmailUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon aria-hidden="true" />
                  Ouvrir dans Gmail
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              </Button>
            )}
          </section>

          <section aria-labelledby={`${uid}-move`} className="flex flex-col gap-2">
            <h3 id={`${uid}-move`} className="text-base font-semibold">
              Corriger le statut
            </h3>
            <p className="text-muted-foreground text-sm">
              Le classement automatique s&apos;est trompé ? Déplace la carte : la synchronisation ne
              la changera plus de colonne.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${uid}-target`}>Déplacer vers</Label>
                <NativeSelect
                  id={`${uid}-target`}
                  value={target}
                  onChange={(e) => setTarget(e.target.value as TrackerColumn)}
                  disabled={busy}
                >
                  {TRACKER_COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.id === card.column && !bounced ? " (actuelle)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void move()}
                disabled={moveDisabled}
              >
                {pending === "move" && (
                  <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                )}
                Déplacer
              </Button>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t p-4 sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onClose}
            disabled={busy}
          >
            Fermer
          </Button>
        </div>
      </div>
    </dialog>
  );
}
