/**
 * Pure helpers of the hunter screen (SPEC §7.3): score bands, progress
 * steps, polling delays, filters and French labels. No React, no server
 * code: unit-tested in tests/hunter-ui-utils.test.ts.
 */

// ---------------------------------------------------------------------------
// Shared view types (mirror the lib/hunter contract, kept structural so this
// module stays importable from Client Components)
// ---------------------------------------------------------------------------

export type CompanySize = "any" | "small" | "medium" | "large";
export type LeadStatus = "suggested" | "selected" | "dismissed" | "drafted" | "sent";
export type SearchStep = "naf" | "fetch" | "prefilter" | "scoring" | "done";
export type SearchState = "running" | "done" | "failed";

export type SearchProgressInfo = {
  step?: SearchStep;
  done?: number;
  total?: number;
};

export type LeadFilters = {
  minScore?: number;
  size?: CompanySize;
  maxDistanceKm?: number;
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "any", label: "Toutes tailles" },
  { value: "small", label: "Petites (< 50)" },
  { value: "medium", label: "Moyennes (50–249)" },
  { value: "large", label: "Grandes (250+)" },
];

export const MIN_SCORE_OPTIONS = [0, 50, 70, 85] as const;
export const MAX_DISTANCE_OPTIONS = [0, 5, 10, 20, 30, 50, 100] as const; // 0 = no limit

export const RADIUS_MIN_KM = 5;
export const RADIUS_MAX_KM = 100;

/** Clamps a radius to the search bounds (5–100 km), rounding to an integer. */
export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Score bands (color + text, never color only)
// ---------------------------------------------------------------------------

export type ScoreBand = "excellent" | "good" | "fair" | "low" | "unscored";

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  excellent: "Excellent",
  good: "Très bon",
  fair: "Correct",
  low: "Faible",
  unscored: "Non noté",
};

/** Tailwind classes per band (light + dark), contrast ≥ 4.5:1 for the text. */
export const SCORE_BAND_CLASSES: Record<ScoreBand, string> = {
  excellent:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  good: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  fair: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  low: "border-border bg-muted text-foreground",
  unscored: "border-border bg-muted text-muted-foreground",
};

/** 85+ excellent, 70–84 good, 50–69 fair, < 50 low, null/invalid unscored. */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unscored";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "low";
}

/** "87/100 · Excellent" or "Non noté". */
export function scoreText(score: number | null | undefined): string {
  const band = scoreBand(score);
  if (band === "unscored") return SCORE_BAND_LABELS.unscored;
  return `${Math.round(score as number)}/100 · ${SCORE_BAND_LABELS[band]}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "à 4 km", "à moins d'1 km", "à 12,5 km" → rounded: "à 13 km"; null → null. */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return "à moins d'1 km";
  return `à ${Math.round(km)} km`;
}

/** Public company page, or null when the SIREN is not a 9-digit number. */
export function annuaireUrl(siren: unknown): string | null {
  if (typeof siren !== "string") return null;
  const clean = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(clean)) return null;
  return `https://annuaire-entreprises.data.gouv.fr/entreprise/${clean}`;
}

/** "Préparer 1 candidature" / "Préparer 3 candidatures". */
export function prepareLabel(count: number): string {
  return `Préparer ${count} candidature${count > 1 ? "s" : ""}`;
}

/** "30 entreprises" / "1 entreprise" / "Aucune entreprise". */
export function companiesCountLabel(count: number): string {
  if (count === 0) return "Aucune entreprise";
  return `${count} entreprise${count > 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Search progress
// ---------------------------------------------------------------------------

export const SEARCH_STEPS: { step: Exclude<SearchStep, "done">; label: string }[] = [
  { step: "naf", label: "Analyse de ton profil" },
  { step: "fetch", label: "Recherche des entreprises" },
  { step: "prefilter", label: "Pré-sélection" },
  { step: "scoring", label: "Notation par l'IA" },
];

const STEP_ORDER: SearchStep[] = ["naf", "fetch", "prefilter", "scoring", "done"];

export type StepState = "done" | "current" | "pending";

/** State of each displayed step given the current one (unknown step = first). */
export function stepStates(current: SearchStep | undefined): StepState[] {
  const index = current ? STEP_ORDER.indexOf(current) : 0;
  const currentIndex = index < 0 ? 0 : index;
  return SEARCH_STEPS.map((_, i) =>
    i < currentIndex ? "done" : i === currentIndex ? "current" : "pending",
  );
}

/** Label of a step, with "(n/m)" for scoring when the counts are known. */
export function stepLabel(step: SearchStep | undefined, progress?: SearchProgressInfo): string {
  if (step === "done") return "Terminé";
  const entry = SEARCH_STEPS.find((s) => s.step === (step ?? "naf")) ?? SEARCH_STEPS[0];
  if (
    entry.step === "scoring" &&
    progress &&
    typeof progress.done === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  ) {
    return `${entry.label} (${Math.min(progress.done, progress.total)}/${progress.total})`;
  }
  return entry.label;
}

/**
 * Rough overall percentage for the progress bar: the first three steps are
 * fast, the LLM scoring takes most of the time (35 % → 98 %).
 */
export function progressPercent(progress: SearchProgressInfo | undefined): number {
  switch (progress?.step) {
    case "fetch":
      return 15;
    case "prefilter":
      return 30;
    case "scoring": {
      const { done, total } = progress;
      if (typeof done !== "number" || typeof total !== "number" || total <= 0) return 35;
      const ratio = Math.min(1, Math.max(0, done / total));
      return Math.round(35 + ratio * 63);
    }
    case "done":
      return 100;
    case "naf":
    default:
      return 5;
  }
}

/** A search still "running" after this long almost certainly died (function timeout). */
export const STALE_SEARCH_MS = 6 * 60 * 1000;

export function isStaleSearch(createdAt: string, now: number = Date.now()): boolean {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return false;
  return now - started > STALE_SEARCH_MS;
}

// ---------------------------------------------------------------------------
// Polling backoff
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 1500;
export const POLL_HIDDEN_INTERVAL_MS = 10_000;
export const POLL_MAX_INTERVAL_MS = 15_000;

/**
 * Delay before the next status poll: 1.5 s normally, 10 s while the tab is
 * hidden, doubled after each consecutive network error (capped at 15 s).
 */
export function nextPollDelay({
  hidden,
  consecutiveErrors,
}: {
  hidden: boolean;
  consecutiveErrors: number;
}): number {
  const base = hidden ? POLL_HIDDEN_INTERVAL_MS : POLL_INTERVAL_MS;
  const errors = Math.max(0, Math.min(consecutiveErrors, 10));
  return Math.min(POLL_MAX_INTERVAL_MS, Math.max(base, POLL_INTERVAL_MS * 2 ** errors));
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterUiState = { minScore: number; size: CompanySize; maxDistanceKm: number };

export const DEFAULT_FILTERS: FilterUiState = { minScore: 0, size: "any", maxDistanceKm: 0 };

/** UI state → listLeads filters (neutral values are omitted). */
export function toLeadFilters(ui: FilterUiState): LeadFilters {
  const filters: LeadFilters = {};
  if (ui.minScore > 0) filters.minScore = ui.minScore;
  if (ui.size !== "any") filters.size = ui.size;
  if (ui.maxDistanceKm > 0) filters.maxDistanceKm = ui.maxDistanceKm;
  return filters;
}

export function hasActiveFilters(ui: FilterUiState): boolean {
  return Object.keys(toLeadFilters(ui)).length > 0;
}

type LeadLike = {
  id: string;
  status: LeadStatus;
  fit_score: number | null;
  distance_km: number | null;
};

/**
 * Applies the optimistic status overrides and drops dismissed leads, except
 * those the user just dismissed (kept to show the inline "Annuler").
 * Score and distance filters are re-applied client side so an instant
 * filter change never shows a lead the server would have excluded.
 */
export function visibleLeads<T extends LeadLike>(
  leads: readonly T[],
  {
    overrides = {},
    undoIds = new Set<string>(),
    filters = DEFAULT_FILTERS,
  }: {
    overrides?: Readonly<Record<string, LeadStatus>>;
    undoIds?: ReadonlySet<string>;
    filters?: FilterUiState;
  } = {},
): T[] {
  return leads
    .map((lead) => (overrides[lead.id] ? { ...lead, status: overrides[lead.id] } : lead))
    .filter((lead) => {
      if (lead.status === "dismissed" && !undoIds.has(lead.id)) return false;
      if (filters.minScore > 0 && (lead.fit_score ?? -1) < filters.minScore) return false;
      if (
        filters.maxDistanceKm > 0 &&
        lead.distance_km !== null &&
        lead.distance_km > filters.maxDistanceKm
      ) {
        return false;
      }
      return true;
    });
}

/** Number of leads currently selected, overrides included. */
export function countSelected(
  leads: Iterable<{ id: string; status: LeadStatus }>,
  overrides: Readonly<Record<string, LeadStatus>> = {},
): number {
  let n = 0;
  for (const lead of leads) if ((overrides[lead.id] ?? lead.status) === "selected") n += 1;
  return n;
}

/** Merges a freshly fetched list into the known leads (by id, latest wins). */
export function mergeLeads<T extends { id: string }>(
  known: ReadonlyMap<string, T>,
  fetched: readonly T[],
): Map<string, T> {
  const next = new Map(known);
  for (const lead of fetched) next.set(lead.id, lead);
  return next;
}
