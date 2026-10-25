/**
 * Deterministic pre-filter (SPEC §7.2 step 1, no LLM): exclusions + a 0–100 score
 * from distance, size fit and NAF priority. Keeps the best `limit` (60).
 */
import type { ContractType } from "@/lib/profile/schema";

import { matchesSizeFilter } from "./headcount";
import type { NormalizedCompany, SizeFilter } from "./types";

export const PREFILTER_LIMIT = 60;

export type ExclusionReason =
  | "closed"
  | "individual"
  | "unknown_size"
  | "contacted"
  | "too_far"
  | "size_mismatch"
  | "duplicate";

export type PrefilterOptions = {
  radiusKm: number;
  /** NAF codes in priority order (map_naf output order). */
  nafCodes: readonly string[];
  /** SIRENs the user already contacted (leads drafted/sent or with an application). */
  contactedSirens?: Iterable<string>;
  /** Exclude unknown or 0 headcount (default true). */
  excludeUnknownSize?: boolean;
  size?: SizeFilter;
  contractType?: ContractType | null;
  limit?: number;
};

export type PrefilteredCompany = NormalizedCompany & { prefilter_score: number };

export type PrefilterResult = {
  kept: PrefilteredCompany[];
  excluded: Record<ExclusionReason, number>;
  /** Eligible companies before applying the limit. */
  eligibleCount: number;
};

const WEIGHTS = { distance: 40, size: 30, naf: 30 } as const;

/** 1 at 0 km, 0.1 at the radius edge; unknown distance counts as the edge. */
export function distanceFit(distanceKm: number | null, radiusKm: number): number {
  if (distanceKm === null || radiusKm <= 0) return 0.1;
  return Math.max(0.1, 1 - (0.9 * Math.min(distanceKm, radiusKm)) / radiusKm);
}

/**
 * Sweet spot 10–249 employees for alternance / stage; large companies are fine
 * but slightly lower; very small ones lower. CDI/CDD: no penalty for large.
 */
export function sizeFit(headcountMin: number | null, contractType?: ContractType | null): number {
  if (headcountMin === null || headcountMin <= 0) return 0.2;
  if (headcountMin < 3) return 0.3;
  if (headcountMin < 6) return 0.4;
  if (headcountMin < 10) return 0.55;
  if (headcountMin < 250) return 1;
  const permanent = contractType === "cdi" || contractType === "cdd";
  if (headcountMin < 2000) return permanent ? 1 : 0.85;
  return permanent ? 0.95 : 0.75;
}

/** 1 for the first code, decreasing to 0.4 for the last; 0.2 when not in the list. */
export function nafFit(nafCode: string | null, nafCodes: readonly string[]): number {
  const rank = nafCode ? nafCodes.indexOf(nafCode) : -1;
  if (rank === -1) return 0.2;
  if (nafCodes.length <= 1) return 1;
  return 1 - (0.6 * rank) / (nafCodes.length - 1);
}

export function prefilterScore(
  c: NormalizedCompany,
  opts: Pick<PrefilterOptions, "radiusKm" | "nafCodes" | "contractType">,
): number {
  const score =
    WEIGHTS.distance * distanceFit(c.establishment?.distance_km ?? null, opts.radiusKm) +
    WEIGHTS.size * sizeFit(c.headcount_min, opts.contractType) +
    WEIGHTS.naf * nafFit(c.naf_code, opts.nafCodes);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function prefilterCompanies(
  companies: readonly NormalizedCompany[],
  opts: PrefilterOptions,
): PrefilterResult {
  const excluded: Record<ExclusionReason, number> = {
    closed: 0,
    individual: 0,
    unknown_size: 0,
    contacted: 0,
    too_far: 0,
    size_mismatch: 0,
    duplicate: 0,
  };
  const contacted = new Set(opts.contactedSirens ?? []);
  const excludeUnknown = opts.excludeUnknownSize ?? true;
  const size = opts.size ?? "any";
  const seen = new Set<string>();
  const eligible: PrefilteredCompany[] = [];

  for (const c of companies) {
    let reason: ExclusionReason | null = null;
    const distance = c.establishment?.distance_km ?? null;
    if (seen.has(c.siren)) reason = "duplicate";
    else if (!c.is_active) reason = "closed";
    else if (c.is_individual) reason = "individual";
    else if (contacted.has(c.siren)) reason = "contacted";
    else if (excludeUnknown && (c.headcount_min === null || c.headcount_min <= 0)) {
      reason = "unknown_size";
    } else if (distance !== null && distance > opts.radiusKm) reason = "too_far";
    else if (!matchesSizeFilter(c.headcount_min, size)) reason = "size_mismatch";

    if (reason) {
      excluded[reason]++;
      continue;
    }
    seen.add(c.siren);
    eligible.push({ ...c, prefilter_score: prefilterScore(c, opts) });
  }

  eligible.sort(
    (a, b) =>
      b.prefilter_score - a.prefilter_score ||
      (a.establishment?.distance_km ?? Infinity) - (b.establishment?.distance_km ?? Infinity) ||
      a.siren.localeCompare(b.siren),
  );
  return {
    kept: eligible.slice(0, opts.limit ?? PREFILTER_LIMIT),
    excluded,
    eligibleCount: eligible.length,
  };
}
