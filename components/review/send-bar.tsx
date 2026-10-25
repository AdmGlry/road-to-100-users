"use client";

import { LoaderCircleIcon, SendIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { quotaLabel, sendButtonLabel, sendDurationLabel } from "@/components/review/review-utils";
import { Button } from "@/components/ui/button";
import {
  SEND_SPACING_MAX_S,
  SEND_SPACING_MIN_S,
  type ReviewItem,
  type SendQuota,
} from "@/lib/hunter/application-types";

/**
 * Sticky bottom bar "Envoyer les N mails validés" + remaining quota. The
 * button opens an explicit confirmation step (count, recipients, quota
 * left, 30–90 s spacing): nothing is sent before "Confirmer l'envoi".
 */
export function SendBar({
  sendable,
  quota,
  gmailEmail,
  pending,
  error,
  onConfirm,
  onClearError,
}: {
  sendable: ReviewItem[];
  quota: SendQuota;
  gmailEmail: string | null;
  pending: boolean;
  error: string | null;
  onConfirm: (applicationIds: string[]) => Promise<boolean>;
  onClearError: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  const count = sendable.length;
  const remaining = Math.max(0, quota.remaining);
  const blocked = count === 0 || remaining === 0;

  const note =
    remaining === 0
      ? "Quota atteint : tes mails validés restent prêts, tu pourras les envoyer dans les prochaines heures."
      : count === 0
        ? "Valide au moins un mail pour pouvoir l'envoyer."
        : count > remaining
          ? `Seuls ${remaining} mail${remaining > 1 ? "s" : ""} pourront partir maintenant ; les autres resteront validés.`
          : null;

  return (
    <>
      {/* Sticky (not fixed): it never covers the last card. */}
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-4 mt-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{count}</span>{" "}
              {count > 1 ? "mails validés prêts à partir" : "mail validé prêt à partir"}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">{quotaLabel(quota)}</p>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <Button
              size="lg"
              className="w-full md:w-auto"
              disabled={blocked || pending}
              aria-describedby={note ? noteId : undefined}
              onClick={() => {
                onClearError();
                setConfirming(true);
              }}
            >
              {pending ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <SendIcon aria-hidden="true" />
              )}
              {sendButtonLabel(count)}
            </Button>
            {note && (
              <p id={noteId} className="text-muted-foreground text-xs md:text-right">
                {note}
              </p>
            )}
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmSendDialog
          items={sendable.slice(0, remaining)}
          extra={Math.max(0, count - remaining)}
          remainingAfter={Math.max(0, remaining - Math.min(count, remaining))}
          limit={quota.limit}
          gmailEmail={gmailEmail}
          pending={pending}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={async (ids) => {
            const ok = await onConfirm(ids);
            if (ok) setConfirming(false);
          }}
        />
      )}
    </>
  );
}

function ConfirmSendDialog({
  items,
  extra,
  remainingAfter,
  limit,
  gmailEmail,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  items: ReviewItem[];
  extra: number;
  remainingAfter: number;
  limit: number;
  gmailEmail: string | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const n = items.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // Start on "Annuler": a stray Enter never sends.
      cancelRef.current?.focus();
    }
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="motion-dialog bg-background text-foreground dark:bg-card m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg rounded-xl border p-0 shadow-[0_16px_48px_-12px_rgb(23_27_52/0.35)] backdrop:bg-[rgb(15_18_38/0.55)] dark:backdrop:bg-black/75"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex flex-col gap-1.5 border-b p-4 sm:p-6">
          <h2 id={titleId} className="text-lg font-semibold">
            {n > 1 ? `Envoyer ${n} mails depuis ton Gmail ?` : "Envoyer ce mail depuis ton Gmail ?"}
          </h2>
          <p id={descId} className="text-muted-foreground text-sm">
            {gmailEmail ? (
              <>
                Expéditeur :{" "}
                <span className="text-foreground font-medium wrap-anywhere" translate="no">
                  {gmailEmail}
                </span>
                , avec ton CV en pièce jointe.
              </>
            ) : (
              "Depuis ton adresse Gmail, avec ton CV en pièce jointe."
            )}
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <ul className="flex flex-col gap-2 text-sm" aria-label="Mails envoyés">
            {items.map((item) => (
              <li
                key={item.applicationId}
                className="flex min-w-0 flex-col rounded-md border p-2.5"
              >
                <span className="font-medium wrap-anywhere" translate="no">
                  {item.company.name}
                </span>
                <span className="text-muted-foreground wrap-anywhere" translate="no">
                  {item.contact?.email}
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              Les mails partent un par un, espacés de {SEND_SPACING_MIN_S} à {SEND_SPACING_MAX_S}{" "}
              secondes. {sendDurationLabel(n)}
            </li>
            <li className="tabular-nums">
              Il te restera {remainingAfter} envoi{remainingAfter > 1 ? "s" : ""} sur {limit} pour
              les prochaines 24 h.
            </li>
            {extra > 0 && (
              <li>
                {extra} autre{extra > 1 ? "s" : ""} mail{extra > 1 ? "s" : ""} validé
                {extra > 1 ? "s" : ""} attendr{extra > 1 ? "ont" : "a"} que ton quota se libère.
              </li>
            )}
            <li>
              Tant qu&apos;un mail est en file d&apos;attente, tu peux encore annuler son envoi.
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-3 border-t p-4 sm:p-6">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => onConfirm(items.map((i) => i.applicationId))}
              disabled={pending || n === 0}
            >
              {pending ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <SendIcon aria-hidden="true" />
              )}
              {pending
                ? "Mise en file d'envoi…"
                : n > 1
                  ? `Confirmer l'envoi des ${n} mails`
                  : "Confirmer l'envoi"}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
