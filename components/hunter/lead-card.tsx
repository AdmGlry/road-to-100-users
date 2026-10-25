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
  const uid = useId();
  const titleId = `${uid}-title`;
  const detailsId = `${uid}-details`;

  if (lead.status === "dismissed") {
    return (
      <div
        role="status"
        className="bg-muted/50 flex h-full flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3 text-sm"
      >
        <span className="text-muted-foreground min-w-0">
          <span className="text-foreground font-medium">{lead.name}</span> ignorée.
        </span>
        <Button variant="outline" size="sm" onClick={onUndoDismiss} className="h-10">
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
  const hasMore = reasons.length > 3 || Boolean(companyUrl) || Boolean(lead.naf_label);

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "bg-card text-card-foreground flex h-full flex-col gap-3 rounded-xl border p-4 shadow-sm transition-colors",
        selected && "border-primary ring-primary/30 ring-2",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="leading-snug font-semibold break-words">
            {lead.name}
          </h3>
          {lead.naf_label && (
            <p className="text-muted-foreground mt-0.5 flex items-start gap-1.5 text-sm">
              <BuildingIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {/* line-clamp on the text only: on the <p> it would override `flex`. */}
              <span className={cn("min-w-0", !expanded && "line-clamp-2")}>{lead.naf_label}</span>
            </p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-xs font-semibold whitespace-nowrap",
            SCORE_BAND_CLASSES[band],
          )}
        >
          <span className="sr-only">Compatibilité : </span>
          {scoreText(lead.fit_score)}
        </span>
      </div>

      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(lead.city || distance) && (
          <li className="flex items-center gap-1.5">
            <MapPinIcon aria-hidden="true" className="size-3.5" />
            {[lead.city, distance].filter(Boolean).join(" · ")}
          </li>
        )}
        {lead.headcount_label && (
          <li className="flex items-center gap-1.5">
            <UsersIcon aria-hidden="true" className="size-3.5" />
            {lead.headcount_label}
          </li>
        )}
      </ul>

      {shownReasons.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Pourquoi cette entreprise">
          {shownReasons.map((reason, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="text-muted-foreground">
                •
              </span>
              <span className="min-w-0">{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div id={detailsId} className="flex flex-col gap-2 text-sm">
          {companyUrl ? (
            <a
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex min-h-10 w-fit items-center gap-1.5 underline-offset-4 hover:underline"
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
          <label className="hover:bg-accent -ml-2 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium">
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
                className={cn("transition-transform", expanded && "rotate-180")}
              />
            </Button>
          )}
          {!locked && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={onDismiss}
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
