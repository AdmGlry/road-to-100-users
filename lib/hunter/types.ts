/**
 * Hunter (Chasseur) shared types and search parameters (SPEC §7.1–7.3).
 */
import { z } from "zod";

import { contractTypeSchema, type EditableProfile } from "@/lib/profile/schema";

export const SIZE_FILTERS = ["any", "small", "medium", "large"] as const;
export const sizeFilterSchema = z.enum(SIZE_FILTERS);
/** "small" = 1–49 employees, "medium" = 50–249, "large" = 250+ (see lib/hunter/headcount.ts). */
export type SizeFilter = z.infer<typeof sizeFilterSchema>;
export type SizeBucket = Exclude<SizeFilter, "any">;

export const RADIUS_MIN_KM = 5;
export const RADIUS_MAX_KM = 100;
export const DEFAULT_RADIUS_KM = 30;

const tag = z.string().trim().min(1).max(100);

export const hunterSearchParamsSchema = z
  .object({
    roles: z.array(tag).max(10),
    sectors: z.array(tag).max(10),
    city: z
      .string()
      .trim()
      .min(1, { error: "Indique une ville." })
      .max(100, { error: "Nom de ville trop long." }),
    radius_km: z
      .number()
      .int()
      .min(RADIUS_MIN_KM, { error: `Le rayon doit être d'au moins ${RADIUS_MIN_KM} km.` })
      .max(RADIUS_MAX_KM, { error: `Le rayon ne peut pas dépasser ${RADIUS_MAX_KM} km.` }),
    contract_type: contractTypeSchema.nullable(),
    size: sizeFilterSchema,
  })
  .refine((p) => p.roles.length + p.sectors.length > 0, {
    error: "Indique au moins un rôle ou un secteur visé.",
    path: ["roles"],
  });
export type HunterSearchParams = z.infer<typeof hunterSearchParamsSchema>;

/** Pre-fills the search form from the profile. The result may still need a city. */
export function defaultParamsFromProfile(profile: EditableProfile): HunterSearchParams {
  const radius = Number.isFinite(profile.search_radius_km)
    ? Math.round(profile.search_radius_km)
    : DEFAULT_RADIUS_KM;
  return {
    roles: profile.target_roles.slice(0, 10),
    sectors: profile.target_sectors.slice(0, 10),
    city: profile.city?.trim() ?? "",
    radius_km: Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, radius)),
    contract_type: profile.contract_type,
    size: "any",
  };
}

export type SearchStep = "naf" | "fetch" | "prefilter" | "scoring" | "done";

/** `searches.progress` jsonb. */
export type SearchProgress = { step: SearchStep; done: number; total: number };

export type SearchStatusValue = "running" | "done" | "failed";

export type LeadStatus = "suggested" | "selected" | "dismissed" | "drafted" | "sent";

export type Leader = { first_name: string; last_name: string; role: string };

export type Establishment = {
  siret: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  /** Distance from the search origin, rounded to 0.1 km; null when unknown. */
  distance_km: number | null;
};

/** A company from the API, normalized (lib/integrations/companies.ts normalizeCompany). */
export type NormalizedCompany = {
  siren: string;
  name: string;
  naf_code: string | null;
  naf_label: string | null;
  headcount_code: string | null;
  headcount_label: string;
  headcount_min: number | null;
  category: "PME" | "ETI" | "GE" | null;
  is_active: boolean;
  is_association: boolean;
  is_individual: boolean;
  leaders: Leader[];
  /** Small subset of the API response stored in companies.raw (no dirigeant data). */
  raw_minimal: Record<string, unknown>;
  establishment: Establishment | null;
};

export type GeoPoint = { lat: number; lng: number };
