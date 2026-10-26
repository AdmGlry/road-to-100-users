"use client";

import { CheckIcon, LoaderCircleIcon, SendIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  dismissFollowupAction,
  sendFollowupAction,
  updateFollowupAction,
  type TrackerStateResult,
} from "@/app/(app)/tracker/actions";
import {
  countWords,
  followupLengthState,
  followupWordsLabel,
  relativeTime,
} from "@/components/tracker/tracker-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { GmailStatus } from "@/lib/hunter/application-types";
import type { TrackerCard, TrackerState } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

type Pending = "save" | "send" | "dismiss" | null;
type Confirm = "send" | "dismiss" | null;

const CONNECTION_LOST = "Connexion perdue : rien n'a été envoyé ni enregistré. Réessaie.";

/** Follow-up of one application (SPEC §8.3): nothing leaves without an explicit confirmation. */
export function FollowupPanel({
  card,
  gmail,
  now,
  onState,
  onAnnounce,
  onBusyChange,
}: {
  card: TrackerCard;
  gmail: GmailStatus;
  now: number;
  onState: (state: TrackerState) => void;
  onAnnounce: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const followup = card.followup;
  const uid = useId();
  const [subject, setSubject] = useState(followup?.subject ?? "");
  const [body, setBody] = useState(followup?.body ?? "");
  const [pending, setPending] = useState<Pending>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<string | null>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);

  if (!followup) return null;

  const titleId = `${uid}-title`;
  const heading = (
    <h3 id={titleId} className="text-base font-semibold">
      Relance
    </h3>
  );

  if (followup.status !== "draft") {
    const sentAt = relativeTime(followup.sent_at, now);
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-lg border p-3">
        {heading}
        {followup.status === "sending" && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Relance en cours d&apos;envoi…
          </p>
        )}
        {followup.status === "sent" && (
          <p className="text-success flex items-center gap-2 text-sm font-medium">
            <CheckIcon aria-hidden="true" className="size-4" />
            Relance envoyée{sentAt ? ` ${sentAt}` : ""}, dans le même fil Gmail.
          </p>
        )}
        {followup.status === "dismissed" && (
          <p className="text-muted-foreground text-sm">
            Tu as choisi de ne pas relancer cette entreprise.
          </p>
        )}
        {followup.error && followup.status !== "sent" && (
          <p role="alert" className="text-destructive text-sm wrap-anywhere">
            {followup.error}
          </p>
        )}
      </section>
    );
  }

  const gmailReady = gmail.state === "active" && !gmail.missingScopes;
  const words = countWords(body);
  const length = followupLengthState(words);
  const dirty = subject.trim() !== followup.subject.trim() || body.trim() !== followup.body.trim();
  const busy = pending !== null;
  const empty = body.trim().length === 0 || subject.trim().length === 0;

  const run = async (
    kind: Exclude<Pending, null>,
    action: () => Promise<TrackerStateResult>,
  ): Promise<boolean> => {
    setPending(kind);
    onBusyChange(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      onState(result.state);
      return true;
    } catch {
      setError(CONNECTION_LOST);
      return false;
    } finally {
      setPending(null);
      onBusyChange(false);
    }
  };

  const save = () =>
    run("save", () => updateFollowupAction(card.applicationId, { subject, body })).then((ok) => {
      if (ok) onAnnounce(`Relance pour ${card.company.name} enregistrée.`);
      return ok;
    });

  const openConfirm = (kind: Exclude<Confirm, null>) => {
    setError(null);
    setConfirm(kind);
    requestAnimationFrame(() => confirmCancelRef.current?.focus());
  };

  const cancelConfirm = () => {
    const trigger = confirm === "dismiss" ? dismissRef : sendRef;
    setConfirm(null);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  const confirmSend = async () => {
    // Unsaved edits are saved first: the text the student sees is the one sent.
    if (dirty) {
      const saved = await run("save", () =>
        updateFollowupAction(card.applicationId, { subject, body }),
      );
      if (!saved) {
        setConfirm(null);
        return;
      }
    }
    const ok = await run("send", () => sendFollowupAction(card.applicationId));
    setConfirm(null);
    if (ok) onAnnounce(`Relance envoyée à ${card.company.name}.`);
  };

  const confirmDismiss = async () => {
    const ok = await run("dismiss", () => dismissFollowupAction(card.applicationId));
    setConfirm(null);
    if (ok) onAnnounce(`Pas de relance pour ${card.company.name}.`);
  };

  return (
    <section
      aria-labelledby={titleId}
      className="border-warning/40 flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex flex-col gap-1">
        {heading}
        <p className="text-muted-foreground text-sm">
          Pas de réponse depuis une semaine : voici une relance courte, à relire avant de
          l&apos;envoyer.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-subject`}>Objet</Label>
        <Input
          id={`${uid}-subject`}
          name="followup-subject"
          autoComplete="off"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          disabled={busy || confirm !== null}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-body`}>Texte de la relance</Label>
        <Textarea
          id={`${uid}-body`}
          name="followup-body"
          autoComplete="off"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          maxLength={2000}
          aria-describedby={`${uid}-words`}
          disabled={busy || confirm !== null}
        />
        <p
          id={`${uid}-words`}
          className={cn(
            "text-xs tabular-nums",
            length === "ok" ? "text-muted-foreground" : "text-warning",
          )}
        >
          {followupWordsLabel(words)}
        </p>
      </div>

      {followup.error && (
        <p role="alert" className="text-destructive text-sm wrap-anywhere">
          {followup.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm wrap-anywhere">
          {error}
        </p>
      )}
      {!gmailReady && (
        <p className="text-warning text-sm">
          Reconnecte ton Gmail pour pouvoir envoyer cette relance.
        </p>
      )}

      {confirm ? (
        <div
          role="group"
          aria-labelledby={`${uid}-confirm`}
          className="bg-muted flex flex-col gap-3 rounded-md p-3"
        >
          <p id={`${uid}-confirm`} className="text-sm">
            {confirm === "send" ? (
              <>
                La relance partira depuis ton Gmail
                {gmail.email && (
                  <>
                    {" "}
                    (
                    <span className="font-medium wrap-anywhere" translate="no">
                      {gmail.email}
                    </span>
                    )
                  </>
                )}
                , dans le même fil de discussion que ton premier mail à{" "}
                <span translate="no">{card.company.name}</span>. Elle ne pourra plus être annulée.
                {dirty && " Tes modifications seront enregistrées avant l'envoi."}
              </>
            ) : (
              "Aucune relance ne sera envoyée pour cette candidature. Tu ne pourras pas revenir en arrière."
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              ref={confirmCancelRef}
              type="button"
              variant="outline"
              onClick={cancelConfirm}
              disabled={busy}
            >
              Annuler
            </Button>
            {confirm === "send" ? (
              <Button type="button" onClick={() => void confirmSend()} disabled={busy}>
                {busy ? (
                  <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                ) : (
                  <SendIcon aria-hidden="true" />
                )}
                {pending === "save"
                  ? "Enregistrement…"
                  : pending === "send"
                    ? "Envoi…"
                    : "Confirmer l'envoi"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDismiss()}
                disabled={busy}
              >
                {busy && <LoaderCircleIcon aria-hidden="true" className="animate-spin" />}
                Ne pas relancer
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            ref={sendRef}
            type="button"
            onClick={() => openConfirm("send")}
            disabled={busy || !gmailReady || empty}
          >
            <SendIcon aria-hidden="true" />
            Envoyer la relance
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void save()}
              disabled={busy || empty}
            >
              {pending === "save" && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              {pending === "save" ? "Enregistrement…" : "Enregistrer"}
            </Button>
          )}
          <Button
            ref={dismissRef}
            type="button"
            variant="ghost"
            onClick={() => openConfirm("dismiss")}
            disabled={busy}
          >
            Ne pas relancer
          </Button>
        </div>
      )}
    </section>
  );
}
