"use client";

import {
  BuildingIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";
import { useId, useState } from "react";

import type { Lead } from "@/app/(app)/hunter/actions";
import {
  annuaireUrl,
  formatDistance,
  SCORE_BAND_CLASSES,
  scoreBand,
  scoreText,
} from "@/components/hunter/hunter-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const LOCKED_LABELS: Partial<Record<Lead["status"], string>> = {
  drafted: "Candidature préparée",
  sent: "Candidature envoyée",
};

/** Above this length a reason may exceed its 3-line clamp: "Voir plus" shows it in full. */
const REASON_CLAMP_CHARS = 120;

/** One company proposed to the student (SPEC §7.3). */
export function LeadCard({
  lead,
  onToggleSelect,
  onDismiss,
  onUndoDismiss,
}: {
  lead: Lead;
  onToggleSelect: (selected: boolean) => void;
  onDismiss: () => void;
  onUndoDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Animate the swap card ⇄ "ignorée" row only after the student acted on it,
  // never on the first render of the list.
  const [touched, setTouched] = useState(false);
  const uid = useId();
  const titleId = `${uid}-title`;
  const detailsId = `${uid}-details`;

  if (lead.status === "dismissed") {
    return (
      <div
        role="status"
        className={cn(
          "bg-muted/50 flex h-full flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3 text-sm",
          touched && "motion-enter",
        )}
      >
        <span className="text-muted-foreground min-w-0 wrap-anywhere">
          <span className="text-foreground font-medium" dir="auto" translate="no">
            {lead.name}
          </span>{" "}
          ignorée.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onUndoDismiss}
          className="h-10"
          aria-label={`Annuler : remettre ${lead.name} dans la liste`}
        >
          Annuler
        </Button>
      </div>
    );
  }

  const band = scoreBand(lead.fit_score);
  const distance = formatDistance(lead.distance_km);
  const reasons = lead.fit_reasons ?? [];
  const shownReasons = expanded ? reasons : reasons.slice(0, 3);
  const companyUrl = annuaireUrl(lead.siren);
  const locked = LOCKED_LABELS[lead.status];
  const selected = lead.status === "selected";
  const hasMore =
    reasons.length > 3 ||
    reasons.some((r) => r.length > REASON_CLAMP_CHARS) ||
    Boolean(companyUrl) ||
    Boolean(lead.naf_label);

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "bg-card text-card-foreground flex h-full flex-col gap-3 rounded-xl border p-4",
        // Selection = ink border + ink-tinted paper (flat, no ring or shadow).
        "transition-[background-color,border-color,opacity,translate] duration-(--duration-fast) ease-(--ease-out)",
        selected && "border-primary bg-secondary/40",
        touched && "motion-enter",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Company names are identifiers: wrapped in full (never truncated),
              breaking anywhere only when a word is longer than the column. */}
          <h3
            id={titleId}
            dir="auto"
            translate="no"
            className="leading-snug font-semibold wrap-anywhere"
          >
            {lead.name}
          </h3>
          {lead.naf_label && (
            <p className="text-muted-foreground mt-0.5 flex items-start gap-1.5 text-sm">
              <BuildingIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {/* line-clamp on the text only: on the <p> it would override `flex`. */}
              <span
                className={cn("min-w-0 wrap-anywhere", !expanded && "line-clamp-2")}
                title={expanded ? undefined : lead.naf_label}
              >
                {lead.naf_label}
              </span>
            </p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-sm border px-2 py-1 text-xs font-semibold whitespace-nowrap tabular-nums",
            SCORE_BAND_CLASSES[band],
          )}
        >
          <span className="sr-only">Compatibilité : </span>
          {scoreText(lead.fit_score)}
        </span>
      </div>

      {(lead.city || distance || lead.headcount_label) && (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {(lead.city || distance) && (
            <li className="flex min-w-0 items-start gap-1.5">
              <MapPinIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 wrap-anywhere">
                {[lead.city, distance].filter(Boolean).join(" · ")}
              </span>
            </li>
          )}
          {lead.headcount_label && (
            <li className="flex min-w-0 items-start gap-1.5">
              <UsersIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 tabular-nums">{lead.headcount_label}</span>
            </li>
          )}
        </ul>
      )}

      {shownReasons.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Pourquoi cette entreprise">
          {shownReasons.map((reason, i) => (
            // Reasons revealed by "Voir plus" fade in; the first three never move.
            <li key={i} className={cn("flex gap-2", i >= 3 && "motion-enter")}>
              <span aria-hidden="true" className="text-muted-foreground">
                •
              </span>
              {/* Clamped in the card (stable heights); full text on "Voir plus". */}
              <span className={cn("min-w-0 wrap-anywhere", !expanded && "line-clamp-3")}>
                {reason}
              </span>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div id={detailsId} className="motion-enter flex flex-col gap-2 text-sm">
          {companyUrl ? (
            <a
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary decoration-primary/40 hover:decoration-primary inline-flex min-h-10 w-fit items-center gap-1.5 underline underline-offset-4"
            >
              Voir la fiche sur l&apos;Annuaire des entreprises
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          ) : null}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
        {locked ? (
          <Badge variant="secondary">{locked}</Badge>
        ) : (
          <label className="hover:bg-accent -ml-2 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium select-none">
            <Checkbox
              checked={selected}
              onChange={(e) => onToggleSelect(e.target.checked)}
              className="size-5"
              aria-label={`Sélectionner ${lead.name}`}
            />
            <span aria-hidden="true">Sélectionner</span>
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Voir moins" : "Voir plus"}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "transition-[rotate] duration-(--duration-base) ease-(--ease-out)",
                  expanded && "rotate-180",
                )}
              />
            </Button>
          )}
          {!locked && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={() => {
                setTouched(true);
                onDismiss();
              }}
              aria-label={`Ignorer ${lead.name}`}
            >
              <EyeOffIcon aria-hidden="true" />
              Ignorer
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
