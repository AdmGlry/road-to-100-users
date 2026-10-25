/**
 * `profiles` table row ⇄ EditableProfile (SPEC §4).
 *
 * Rows are read defensively: jsonb columns written by older code or by hand
 * are parsed with Zod and invalid items are dropped (invalid column → []).
 */
import { z } from "zod";

import {
  contractTypeSchema,
  editableProfileSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  type EditableProfile,
} from "./schema";

/** Shape of a `profiles` row (supabase/migrations/20261025000000_init.sql). */
export type ProfileRow = {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  school: string | null;
  degree: string | null;
  contract_type: string | null;
  rhythm: string | null;
  start_date: string | null;
  target_roles: string[] | null;
  target_sectors: string[] | null;
  search_radius_km: number | null;
  skills: string[] | null;
  experiences: unknown;
  education: unknown;
  languages: unknown;
  pitch: string | null;
  cv_storage_path: string | null;
  cv_text: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_SEARCH_RADIUS_KM = 30;

/** Columns the profile editor may write (never user_id, id, cv_* or timestamps). */
export const EDITABLE_COLUMNS = Object.keys(
  editableProfileSchema.shape,
) as (keyof EditableProfile)[];

export function emptyEditableProfile(): EditableProfile {
  return {
    full_name: null,
    email: null,
    phone: null,
    city: null,
    school: null,
    degree: null,
    skills: [],
    experiences: [],
    education: [],
    languages: [],
    pitch: null,
    contract_type: null,
    rhythm: null,
    start_date: null,
    target_roles: [],
    target_sectors: [],
    search_radius_km: DEFAULT_SEARCH_RADIUS_KM,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Keeps the valid items of a jsonb array; anything that is not an array gives []. */
function jsonList<T>(value: unknown, item: z.ZodType<T>): T[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((v) => {
    const r = item.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

function startDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function radius(value: unknown): number {
  const r = editableProfileSchema.shape.search_radius_km.safeParse(value);
  return r.success ? r.data : DEFAULT_SEARCH_RADIUS_KM;
}

export function profileRowToEditable(row: Partial<ProfileRow>): EditableProfile {
  const contract = contractTypeSchema.safeParse(row.contract_type);
  return {
    full_name: text(row.full_name),
    email: text(row.email),
    phone: text(row.phone),
    city: text(row.city),
    school: text(row.school),
    degree: text(row.degree),
    skills: stringList(row.skills),
    experiences: jsonList(row.experiences, experienceSchema),
    education: jsonList(row.education, educationSchema),
    languages: jsonList(row.languages, languageSchema),
    pitch: text(row.pitch),
    contract_type: contract.success ? contract.data : null,
    rhythm: text(row.rhythm),
    start_date: startDate(row.start_date),
    target_roles: stringList(row.target_roles),
    target_sectors: stringList(row.target_sectors),
    search_radius_km: radius(row.search_radius_km),
  };
}

/**
 * Keeps only known editable columns (unknown keys, user_id, cv_* … are
 * dropped) and skips undefined values. Does not validate: callers validate
 * with editableProfileSchema first (see saveProfilePatch).
 */
export function editableToProfileUpdate(p: Partial<EditableProfile>): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  const source = p as Record<string, unknown>;
  for (const column of EDITABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(source, column) && source[column] !== undefined) {
      update[column] = source[column];
    }
  }
  return update;
}
