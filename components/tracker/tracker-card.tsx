import { AlertCircleIcon, ClockIcon, MapPinIcon, UserRoundIcon } from "lucide-react";

import {
  BADGE_TONE_CLASSES,
  classificationLabel,
  classificationTone,
  fullDate,
  latestReply,
  relativeTime,
} from "@/components/tracker/tracker-utils";
import type { TrackerCard as Card } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

export function cardTriggerId(applicationId: string): string {
  return `tracker-card-${applicationId}`;
}

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: keyof typeof BADGE_TONE_CLASSES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold",
        BADGE_TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Compact card of the board. The company name is the button that opens the
 * detail; its hit area is stretched over the whole card.
 */
export function TrackerCard({
  card,
  now,
  onOpen,
}: {
  card: Card;
  now: number;
  onOpen: (applicationId: string) => void;
}) {
  const reply = latestReply(card);
  const sent = relativeTime(card.sent_at, now);
  const bounced = card.status === "bounced";
  const followupDraft = card.followup?.status === "draft";
  const contactLabel = card.contact ? (card.contact.name ?? card.contact.email) : null;

  return (
    <article
      className={cn(
        "bg-card text-card-foreground relative flex min-w-0 flex-col gap-2 rounded-xl border p-3",
        "transition-[border-color] duration-(--duration-fast) ease-(--ease-out)",
        "focus-within:border-primary hover:border-primary/60",
        bounced && "border-destructive/50",
        "[contain-intrinsic-size:auto_7rem] [content-visibility:auto]",
      )}
    >
      <h3 className="text-sm leading-snug font-semibold">
        <button
          type="button"
          id={cardTriggerId(card.applicationId)}
          onClick={() => onOpen(card.applicationId)}
          className="focus-visible:after:outline-ring line-clamp-3 cursor-pointer text-left wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-solid"
          translate="no"
          dir="auto"
        >
          {card.company.name}
          <span className="sr-only">, voir le détail</span>
        </button>
      </h3>

      <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
        {card.company.city && (
          <li className="flex min-w-0 items-start gap-1.5">
            <MapPinIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{card.company.city}</span>
          </li>
        )}
        {contactLabel && (
          <li className="flex min-w-0 items-start gap-1.5">
            <UserRoundIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 truncate" translate="no">
              {contactLabel}
            </span>
          </li>
        )}
        {sent && (
          <li className="flex min-w-0 items-start gap-1.5">
            <ClockIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0" title={fullDate(card.sent_at) ?? undefined}>
              Envoyé {sent}
            </span>
          </li>
        )}
      </ul>

      {(bounced || reply || followupDraft) && (
        <p className="flex flex-wrap gap-1.5">
          {bounced && (
            <StatusChip tone="danger">
              <AlertCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
              Adresse invalide
            </StatusChip>
          )}
          {reply && !(bounced && reply.classification === "bounce") && (
            <StatusChip tone={classificationTone(reply.classification)}>
              {classificationLabel(reply.classification)}
            </StatusChip>
          )}
          {followupDraft && <StatusChip tone="warning">Relance à valider</StatusChip>}
        </p>
      )}
    </article>
  );
}
