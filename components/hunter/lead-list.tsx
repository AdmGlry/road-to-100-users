"use client";

import { AlertCircleIcon, LoaderCircleIcon, SearchXIcon, SendIcon } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";

import { listLeadsAction, setLeadStatusAction, type Lead } from "@/app/(app)/hunter/actions";
import {
  companiesCountLabel,
  countSelected,
  DEFAULT_FILTERS,
  hasActiveFilters,
  MAX_DISTANCE_OPTIONS,
  mergeLeads,
  MIN_SCORE_OPTIONS,
  prepareLabel,
  SIZE_OPTIONS,
  toLeadFilters,
  visibleLeads,
  type CompanySize,
  type FilterUiState,
  type LeadStatus,
} from "@/components/hunter/hunter-utils";
import { LeadCard } from "@/components/hunter/lead-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type EditableStatus = "selected" | "dismissed" | "suggested";

/**
 * Selection screen (SPEC §7.3): filters, lead cards with optimistic
 * select / dismiss (with undo) and the "Préparer N candidatures" bar.
 * Selections are persisted on each change; Sprint 3 will use them.
 */
export function LeadList({
  searchId,
  initialLeads,
  onEditSearch,
}: {
  searchId: string;
  initialLeads: Lead[];
  onEditSearch: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [known, setKnown] = useState<Map<string, Lead>>(() => mergeLeads(new Map(), initialLeads));
  const [overrides, setOverrides] = useState<Record<string, LeadStatus>>({});
  // Leads just dismissed: id → status to restore on "Annuler".
  const [undo, setUndo] = useState<Map<string, EditableStatus>>(new Map());
  const [filters, setFilters] = useState<FilterUiState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fetchSeq = useRef(0);
  const leadSeq = useRef(new Map<string, number>());
  const uid = useId();

  const load = useCallback(
    async (next: FilterUiState) => {
      const seq = ++fetchSeq.current;
      setLoading(true);
      setLoadError(null);
      try {
        const result = await listLeadsAction(searchId, toLeadFilters(next));
        if (seq !== fetchSeq.current) return;
        if (result.ok) {
          setLeads(result.leads);
          setKnown((k) => mergeLeads(k, result.leads));
        } else {
          setLoadError(result.message);
        }
      } catch {
        if (seq === fetchSeq.current) {
          setLoadError("Connexion perdue : impossible de charger les entreprises.");
        }
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    },
    [searchId],
  );

  const changeFilters = (next: FilterUiState) => {
    setFilters(next);
    void load(next);
  };

  /** Optimistic status change, persisted with setLeadStatusAction. */
  const changeStatus = useCallback(async (lead: Lead, status: EditableStatus) => {
    const seq = (leadSeq.current.get(lead.id) ?? 0) + 1;
    leadSeq.current.set(lead.id, seq);
    setOverrides((o) => ({ ...o, [lead.id]: status }));
    setActionError(null);

    const clearOverride = () =>
      setOverrides((o) => {
        const next = { ...o };
        delete next[lead.id];
        return next;
      });

    try {
      const result = await setLeadStatusAction([lead.id], status);
      if (leadSeq.current.get(lead.id) !== seq) return; // a newer change is in flight
      if (result.ok) {
        const apply = (l: Lead) => (l.id === lead.id ? { ...l, status } : l);
        setLeads((list) => list.map(apply));
        setKnown((k) => {
          const current = k.get(lead.id);
          if (!current) return k;
          const next = new Map(k);
          next.set(lead.id, { ...current, status });
          return next;
        });
      } else {
        setActionError(result.message);
      }
      clearOverride();
      return result.ok;
    } catch {
      if (leadSeq.current.get(lead.id) === seq) {
        clearOverride();
        setActionError("Connexion perdue : ton choix n'a pas été enregistré.");
      }
      return false;
    }
  }, []);

  const undoIds = useMemo(() => new Set(undo.keys()), [undo]);
  const shown = useMemo(
    () => visibleLeads(leads, { overrides, undoIds, filters }),
    [leads, overrides, undoIds, filters],
  );
  const activeCount = shown.filter((l) => !undoIds.has(l.id)).length;
  const selectedCount = countSelected(known.values(), overrides);
  const filtered = hasActiveFilters(filters);

  const onToggleSelect = (lead: Lead, selected: boolean) => {
    void changeStatus(lead, selected ? "selected" : "suggested");
    setAnnouncement(selected ? `${lead.name} sélectionnée.` : `${lead.name} désélectionnée.`);
  };

  const onDismiss = (lead: Lead) => {
    const previous: EditableStatus = lead.status === "selected" ? "selected" : "suggested";
    setUndo((u) => new Map(u).set(lead.id, previous));
    void changeStatus(lead, "dismissed");
    setAnnouncement(`${lead.name} ignorée. Bouton Annuler disponible.`);
  };

  const onUndoDismiss = (lead: Lead) => {
    const previous = undo.get(lead.id) ?? "suggested";
    setUndo((u) => {
      const next = new Map(u);
      next.delete(lead.id);
      return next;
    });
    void changeStatus(lead, previous);
    setAnnouncement(`${lead.name} rétablie.`);
  };

  return (
    <section aria-labelledby={`${uid}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`${uid}-heading`} className="text-xl font-semibold tracking-tight">
            Entreprises proposées
          </h2>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {loading && leads.length === 0
              ? "Chargement des entreprises…"
              : `${companiesCountLabel(activeCount)}, triées par compatibilité avec ton profil.`}
          </p>
        </div>
        <PrepareBar count={selectedCount} variant="desktop" />
      </div>

      <FiltersBar filters={filters} onChange={changeFilters} busy={loading && leads.length > 0} />

      {actionError && (
        <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {actionError}
        </p>
      )}

      {loadError ? (
        <Card className="border-destructive/40" role="alert">
          <CardHeader>
            <CardTitle>
              <h3>Impossible d&apos;afficher les entreprises</h3>
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="h-10" onClick={() => void load(filters)}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : loading && leads.length === 0 ? (
        <LeadListSkeleton />
      ) : shown.length === 0 ? (
        <EmptyState
          filtered={filtered}
          onResetFilters={() => changeFilters(DEFAULT_FILTERS)}
          onEditSearch={onEditSearch}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Liste des entreprises">
          {shown.map((lead) => (
            <li key={lead.id}>
              <LeadCard
                lead={lead}
                onToggleSelect={(selected) => onToggleSelect(lead, selected)}
                onDismiss={() => onDismiss(lead)}
                onUndoDismiss={() => onUndoDismiss(lead)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <PrepareBar count={selectedCount} variant="mobile" />
    </section>
  );
}

function FiltersBar({
  filters,
  onChange,
  busy,
}: {
  filters: FilterUiState;
  onChange: (filters: FilterUiState) => void;
  busy: boolean;
}) {
  const uid = useId();
  return (
    <div
      role="group"
      aria-label="Filtres"
      className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3"
    >
      <div className="flex min-w-0 flex-col gap-1.5 sm:w-40">
        <Label htmlFor={`${uid}-score`} className="text-xs">
          Score minimum
        </Label>
        <NativeSelect
          id={`${uid}-score`}
          value={filters.minScore}
          onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })}
          className="h-10"
        >
          {MIN_SCORE_OPTIONS.map((score) => (
            <option key={score} value={score}>
              {score === 0 ? "Tous" : `${score}+`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 sm:w-44">
        <Label htmlFor={`${uid}-size`} className="text-xs">
          Taille
        </Label>
        <NativeSelect
          id={`${uid}-size`}
          value={filters.size}
          onChange={(e) => onChange({ ...filters, size: e.target.value as CompanySize })}
          className="h-10"
        >
          {SIZE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 sm:w-40">
        <Label htmlFor={`${uid}-distance`} className="text-xs">
          Distance max
        </Label>
        <NativeSelect
          id={`${uid}-distance`}
          value={filters.maxDistanceKm}
          onChange={(e) => onChange({ ...filters, maxDistanceKm: Number(e.target.value) })}
          className="h-10"
        >
          {MAX_DISTANCE_OPTIONS.map((km) => (
            <option key={km} value={km}>
              {km === 0 ? "Toutes" : `${km} km`}
            </option>
          ))}
        </NativeSelect>
      </div>
      {busy && (
        <p className="text-muted-foreground col-span-3 flex items-center gap-1.5 text-xs sm:h-10">
          <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
          Mise à jour…
        </p>
      )}
    </div>
  );
}

function EmptyState({
  filtered,
  onResetFilters,
  onEditSearch,
}: {
  filtered: boolean;
  onResetFilters: () => void;
  onEditSearch: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SearchXIcon aria-hidden="true" className="text-muted-foreground size-5" />
          <h3>{filtered ? "Aucune entreprise avec ces filtres" : "Aucune entreprise trouvée"}</h3>
        </CardTitle>
        <CardDescription>
          {filtered
            ? "Assouplis les filtres (score, taille, distance) pour voir plus d'entreprises."
            : "Essaie d'élargir le rayon de recherche, d'ajouter d'autres postes visés ou de retirer des secteurs, puis relance la recherche."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        {filtered && (
          <Button variant="outline" className="h-10" onClick={onResetFilters}>
            Réinitialiser les filtres
          </Button>
        )}
        <Button variant={filtered ? "ghost" : "default"} className="h-10" onClick={onEditSearch}>
          Modifier la recherche
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Sticky bottom bar. Sprint 3 (contact, writing, sending) is not built yet:
 * the button stays disabled with a visible explanation (no hover-only
 * tooltip, which would not work on a phone).
 */
function PrepareBar({ count, variant }: { count: number; variant: "mobile" | "desktop" }) {
  const noteId = useId();
  const label = count > 1 ? "entreprises sélectionnées" : "entreprise sélectionnée";
  const button = (
    <Button size="lg" disabled aria-describedby={noteId} className="w-full md:w-auto">
      <SendIcon aria-hidden="true" />
      {prepareLabel(count)}
    </Button>
  );
  const note = (
    <p id={noteId} className="text-muted-foreground text-xs">
      Disponible au Sprint 3 (rédaction et envoi). Ta sélection est enregistrée.
    </p>
  );

  // Desktop (≥ md): a normal right-aligned action bar next to the list title.
  // display:none on the other breakpoint keeps a single copy in the a11y tree.
  if (variant === "desktop") {
    return (
      <div className="hidden shrink-0 flex-col items-end gap-1 md:flex">
        <div className="flex items-center gap-3">
          <p className="text-sm whitespace-nowrap">
            <span className="font-semibold">{count}</span> {label}
          </p>
          {button}
        </div>
        {note}
      </div>
    );
  }

  // Phone: sticky (not fixed) bottom bar, so it never covers the last card.
  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-4 mt-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm">
          <span className="font-semibold">{count}</span> {label}
        </p>
        {button}
        {note}
      </div>
    </div>
  );
}

export function LeadListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement des entreprises…
      </p>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border p-4" aria-hidden="true">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
              <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            </div>
            <div className="bg-muted h-6 w-24 animate-pulse rounded-md" />
          </div>
          <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-3 w-5/6 animate-pulse rounded" />
          <div className="bg-muted h-8 w-full animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
