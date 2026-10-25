"use client";

import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BuildingIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PencilIcon,
  RotateCwIcon,
  UndoIcon,
  UsersIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  approveApplicationAction,
  changeContactAction,
  dismissApplicationAction,
  regenerateApplicationAction,
  unapproveApplicationAction,
  updateApplicationAction,
  type MutationActionResult,
} from "@/app/(app)/hunter/review/actions";
import { ConfidenceBadge } from "@/components/review/confidence-badge";
import { ContactPicker, type ContactChoice } from "@/components/review/contact-picker";
import {
  bodyLengthState,
  contactName,
  countWords,
  hostnameOf,
  itemPhase,
  looksLikeEmail,
  safeHttpUrl,
  SOURCE_LABELS,
  statusLabel,
  subjectTooLong,
  wordCountLabel,
  type ItemPhase,
} from "@/components/review/review-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SUBJECT_MAX_CHARS,
  type ReviewItem,
  type ReviewState,
} from "@/lib/hunter/application-types";
import { cn } from "@/lib/utils";

type Pending = "save" | "approve" | "unapprove" | "dismiss" | "regenerate" | "contact" | null;
type Confirm = "dismiss" | "regenerate" | null;

const PHASE_CLASSES: Record<ItemPhase, string> = {
  draft: "bg-secondary text-secondary-foreground",
  error: "bg-destructive/10 text-destructive",
  approved: "bg-success-soft text-success",
  queued: "bg-secondary text-secondary-foreground",
  sent: "bg-success-soft text-success",
};

const CONNECTION_LOST = "Connexion perdue : ton changement n'a pas été enregistré. Réessaie.";

/** One mail on the review screen (SPEC §7.6). */
export function MailCard({
  item,
  onState,
  onAnnounce,
}: {
  item: ReviewItem;
  onState: (state: ReviewState | null) => void;
  onAnnounce: (message: string) => void;
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const phase = itemPhase(item);
  const editable = phase !== "sent";
  const approved = phase === "approved" || phase === "queued";

  // Drafts start open; validated / queued / sent mails start collapsed.
  // The override is tied to the phase, so a validation collapses the card.
  const [openOverride, setOpenOverride] = useState<{ phase: ItemPhase; open: boolean } | null>(
    null,
  );
  const open =
    openOverride?.phase === phase ? openOverride.open : phase === "draft" || phase === "error";

  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const words = countWords(editing ? body : item.body);
  const lengthState = bodyLengthState(words);
  const insightUrl = safeHttpUrl(item.company_insight_source);
  const hasContact = item.contact !== null && looksLikeEmail(item.contact.email);
  const busy = pending !== null;
  const dirty = subject.trim() !== item.subject.trim() || body.trim() !== item.body.trim();
  const showPicker = editable && (pickerOpen || (!item.contact && phase !== "sent"));

  const run = async (
    kind: Exclude<Pending, null>,
    action: () => Promise<MutationActionResult>,
    success?: string,
  ): Promise<boolean> => {
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      onState(result.state);
      if (success) onAnnounce(success);
      return true;
    } catch {
      setError(CONNECTION_LOST);
      return false;
    } finally {
      setPending(null);
      setConfirm(null);
    }
  };

  const startEditing = () => {
    setSubject(item.subject);
    setBody(item.body);
    setEditing(true);
    setOpenOverride({ phase, open: true });
    requestAnimationFrame(() => subjectRef.current?.focus());
  };

  const stopEditing = () => {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = async () => {
    if (!dirty) {
      stopEditing();
      return;
    }
    const ok = await run(
      "save",
      () => updateApplicationAction(item.applicationId, { subject, body }),
      approved
        ? `Mail pour ${item.company.name} enregistré. Il repasse en brouillon : valide-le à nouveau.`
        : `Mail pour ${item.company.name} enregistré.`,
    );
    if (ok) stopEditing();
  };

  const chooseContact = async (choice: ContactChoice) => {
    const ok = await run(
      "contact",
      () => changeContactAction(item.applicationId, choice),
      `Destinataire de ${item.company.name} modifié.`,
    );
    if (ok) {
      setPickerOpen(false);
      setNotice("Destinataire modifié. Relis la formule de politesse avant de valider.");
    }
  };

  const regenerate = async () => {
    await run(
      "regenerate",
      () => regenerateApplicationAction(item.applicationId),
      `Nouveau mail rédigé pour ${item.company.name}.`,
    );
  };

  const contact = item.contact;
  const name = contact ? contactName(contact) : null;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-4 sm:p-5",
        "transition-[border-color] duration-(--duration-fast) ease-(--ease-out)",
        approved && "border-success/50",
        phase === "error" && "border-destructive/50",
      )}
    >
      {/* Header: company + status */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3
            id={titleId}
            dir="auto"
            translate="no"
            className="text-base leading-snug font-semibold wrap-anywhere"
          >
            {item.company.name}
          </h3>
          <ul className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {item.company.activity && (
              <li className="flex min-w-0 items-start gap-1.5">
                <BuildingIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2 min-w-0 wrap-anywhere">{item.company.activity}</span>
              </li>
            )}
            {item.company.city && (
              <li className="flex min-w-0 items-start gap-1.5">
                <MapPinIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 wrap-anywhere">{item.company.city}</span>
              </li>
            )}
            <li className="flex items-start gap-1.5">
              <UsersIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="tabular-nums">{item.company.headcount_label}</span>
            </li>
          </ul>
        </div>
        <span
          className={cn(
            "inline-flex w-fit shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold whitespace-nowrap tabular-nums",
            PHASE_CLASSES[phase],
          )}
        >
          {(phase === "approved" || phase === "sent") && (
            <CheckIcon aria-hidden="true" className="size-3.5" />
          )}
          <span className="sr-only">Statut : </span>
          {statusLabel(item)}
        </span>
      </div>

      {/* Send error (the mail is back to draft) */}
      {item.send_error && phase === "error" && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
        >
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{item.send_error}</span>
        </p>
      )}

      {/* Recipient */}
      <section aria-label="Destinataire" className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">Destinataire</p>
        {contact ? (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium wrap-anywhere" translate="no">
                {contact.email}
              </p>
              {(name || contact.role) && (
                <p className="text-muted-foreground text-sm wrap-anywhere">
                  {[name, contact.role].filter(Boolean).join(", ")}
                </p>
              )}
              <p className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge confidence={contact.confidence} />
                <span className="text-muted-foreground text-xs">
                  {SOURCE_LABELS[contact.source]}
                </span>
              </p>
              {contact.confidence === "low" && editable && (
                <p className="text-muted-foreground text-xs">
                  Adresse incertaine : vérifie-la sur le site de l&apos;entreprise ou remplace-la si
                  tu en connais une meilleure.
                </p>
              )}
            </div>
            {editable && !pickerOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-fit shrink-0"
                onClick={() => setPickerOpen(true)}
                disabled={busy}
                aria-label={`Changer le destinataire du mail pour ${item.company.name}`}
              >
                Changer de contact
              </Button>
            )}
          </div>
        ) : (
          phase !== "sent" && (
            <p className="bg-warning-soft text-warning flex items-start gap-2 rounded-md p-3 text-sm">
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Aucune adresse trouvée pour cette entreprise. Ajoute celle de ton choix pour pouvoir
              valider ce mail.
            </p>
          )
        )}
        {showPicker && (
          <ContactPicker
            contacts={item.contacts}
            currentId={contact?.id ?? null}
            companyName={item.company.name}
            approved={approved}
            pending={pending === "contact"}
            onChoose={(choice) => void chooseContact(choice)}
            onCancel={contact ? () => setPickerOpen(false) : undefined}
          />
        )}
      </section>

      {/* Unverified claims: shown before the text, the student must check them. */}
      {item.claims_unverified.length > 0 && phase !== "sent" && (
        <div
          className="border-warning/40 bg-warning-soft flex flex-col gap-1.5 rounded-md border p-3 text-sm"
          role="note"
        >
          <p className="text-warning flex items-start gap-2 font-semibold">
            <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />À vérifier
            avant de valider
          </p>
          <p className="text-foreground/90">
            Ces éléments du mail n&apos;ont pas été retrouvés dans ton profil. S&apos;ils sont
            faux, corrige le mail : on ne doit jamais affirmer ce que tu n&apos;as pas fait.
          </p>
          <ul className="text-foreground list-disc pl-5">
            {item.claims_unverified.map((claim, i) => (
              <li key={i} className="wrap-anywhere">
                {claim}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mail */}
      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-subject`}>Objet</Label>
            <Input
              ref={subjectRef}
              id={`${uid}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              aria-describedby={`${uid}-subject-hint`}
              disabled={busy}
            />
            <p
              id={`${uid}-subject-hint`}
              className={cn(
                "text-xs tabular-nums",
                subjectTooLong(subject) ? "text-warning" : "text-muted-foreground",
              )}
            >
              {subject.trim().length} caractères
              {subjectTooLong(subject)
                ? ` : vise moins de ${SUBJECT_MAX_CHARS} pour qu'il s'affiche en entier.`
                : ` (moins de ${SUBJECT_MAX_CHARS} conseillé)`}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-body`}>Texte du mail</Label>
            <Textarea
              id={`${uid}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              aria-describedby={`${uid}-body-hint`}
              disabled={busy}
              // 16 px on phones (no iOS zoom), grows with the text.
              className="min-h-72 text-base leading-relaxed md:text-sm"
            />
            <p
              id={`${uid}-body-hint`}
              aria-live="polite"
              className={cn(
                "text-xs tabular-nums",
                lengthState === "ok" ? "text-muted-foreground" : "text-warning",
              )}
            >
              {wordCountLabel(words)}
            </p>
          </div>
          {approved && (
            <p className="text-muted-foreground text-xs">
              Ce mail est validé : l&apos;enregistrer retire sa validation (et annule son envoi
              prévu). Tu devras le valider à nouveau.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={stopEditing} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={() => void save()} disabled={busy || !subject.trim() || !body.trim()}>
              {pending === "save" && <LoaderCircleIcon aria-hidden="true" className="animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium">Objet</p>
          <p className="text-sm font-semibold wrap-anywhere">{item.subject}</p>
          {open ? (
            <>
              <div
                id={`${uid}-body`}
                className="bg-background/60 motion-enter mt-1 rounded-md border p-3 text-sm leading-relaxed wrap-anywhere whitespace-pre-line sm:p-4"
              >
                {item.body}
              </div>
              {phase !== "sent" && (
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    lengthState === "ok" ? "text-muted-foreground" : "text-warning",
                  )}
                >
                  {wordCountLabel(words)}
                </p>
              )}
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-10 w-fit"
            aria-expanded={open}
            aria-controls={open ? `${uid}-body` : undefined}
            onClick={() => setOpenOverride({ phase, open: !open })}
          >
            {open ? "Masquer le mail" : "Voir le mail"}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "transition-[rotate] duration-(--duration-base) ease-(--ease-out)",
                open && "rotate-180",
              )}
            />
          </Button>
        </div>
      )}

      {/* Hook used by the mail */}
      {item.company_insight && open && !editing && (
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
          <p className="text-xs font-medium">Accroche utilisée</p>
          <p className="text-foreground/90 wrap-anywhere">{item.company_insight}</p>
          {insightUrl ? (
            <a
              href={insightUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary decoration-primary/40 hover:decoration-primary inline-flex min-h-10 w-fit max-w-full items-center gap-1.5 underline underline-offset-4"
            >
              <span className="min-w-0 truncate">Source : {hostnameOf(insightUrl)}</span>
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          ) : (
            <p className="text-xs">Basée sur l&apos;activité de l&apos;entreprise.</p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{error}</span>
        </p>
      )}

      {/* Inline confirmations */}
      {confirm && (
        <div
          role="group"
          aria-label="Confirmation"
          className="motion-enter bg-muted/50 flex flex-col gap-3 rounded-md border p-3"
        >
          <p className="text-sm">
            {confirm === "dismiss"
              ? `Ignorer ${item.company.name} ? Le mail sera supprimé et l'entreprise ne te sera plus proposée.`
              : "Régénérer ce mail ? Tes modifications seront remplacées par un nouveau texte."}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Annuler
            </Button>
            {confirm === "dismiss" ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(
                    "dismiss",
                    () => dismissApplicationAction(item.applicationId),
                    `${item.company.name} ignorée, mail supprimé.`,
                  )
                }
              >
                {pending === "dismiss" && (
                  <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                )}
                Oui, ignorer
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void regenerate()}
              >
                Oui, régénérer
              </Button>
            )}
          </div>
        </div>
      )}

      {pending === "regenerate" && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Nouvelle rédaction en cours (jusqu&apos;à 40 secondes)…
        </p>
      )}

      {/* Actions */}
      {editable && !editing && !confirm && (
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          {phase === "draft" || phase === "error" ? (
            <Button
              className="w-full sm:w-auto"
              disabled={busy || !hasContact}
              aria-describedby={!hasContact ? `${uid}-approve-hint` : undefined}
              onClick={() =>
                void run(
                  "approve",
                  () => approveApplicationAction(item.applicationId),
                  `Mail pour ${item.company.name} validé.`,
                )
              }
            >
              {pending === "approve" ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <CheckIcon aria-hidden="true" />
              )}
              Valider ce mail
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() =>
                void run(
                  "unapprove",
                  () => unapproveApplicationAction(item.applicationId),
                  phase === "queued"
                    ? `Envoi du mail pour ${item.company.name} annulé.`
                    : `Validation du mail pour ${item.company.name} retirée.`,
                )
              }
            >
              {pending === "unapprove" ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <UndoIcon aria-hidden="true" />
              )}
              {phase === "queued" ? "Annuler l'envoi" : "Retirer la validation"}
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
            <Button
              ref={editButtonRef}
              variant="ghost"
              size="sm"
              className="h-10"
              disabled={busy}
              onClick={startEditing}
              aria-label={`Modifier le mail pour ${item.company.name}`}
            >
              <PencilIcon aria-hidden="true" />
              Modifier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              disabled={busy}
              onClick={() => (item.edited_by_user ? setConfirm("regenerate") : void regenerate())}
              aria-label={`Régénérer le mail pour ${item.company.name}`}
            >
              <RotateCwIcon aria-hidden="true" />
              Régénérer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              disabled={busy}
              onClick={() => setConfirm("dismiss")}
              aria-label={`Ignorer ${item.company.name}`}
            >
              <EyeOffIcon aria-hidden="true" />
              Ignorer
            </Button>
          </div>
          {!hasContact && (phase === "draft" || phase === "error") && (
            <p id={`${uid}-approve-hint`} className="text-muted-foreground text-xs sm:basis-full">
              Ajoute un destinataire pour pouvoir valider.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
