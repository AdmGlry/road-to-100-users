/**
 * Profile data contract (SPEC §4 `profiles`, §5).
 *
 * Shared by the CV parser (lib/profile), the server actions
 * (app/(app)/profile/actions.ts) and the profile UI.
 */
import { z } from "zod";

export const CONTRACT_TYPES = ["alternance", "stage", "cdi", "cdd"] as const;
export const contractTypeSchema = z.enum(CONTRACT_TYPES);
export type ContractType = z.infer<typeof contractTypeSchema>;

export const experienceSchema = z.object({
  title: z.string(),
  company: z.string().nullable(),
  start: z.string().nullable(), // as written on the CV, e.g. "sept. 2024"
  end: z.string().nullable(), // null or "aujourd'hui" when ongoing
  bullets: z.array(z.string()),
});
export type Experience = z.infer<typeof experienceSchema>;

export const educationSchema = z.object({
  degree: z.string(),
  school: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
});
export type Education = z.infer<typeof educationSchema>;

export const languageSchema = z.object({
  language: z.string(),
  level: z.string().nullable(),
});
export type Language = z.infer<typeof languageSchema>;

/** What the LLM extracts from a CV (prompt `extract_profile`). */
export const extractedProfileSchema = z.object({
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  school: z.string().nullable(),
  degree: z.string().nullable(),
  skills: z.array(z.string()),
  experiences: z.array(experienceSchema),
  education: z.array(educationSchema),
  languages: z.array(languageSchema),
  pitch: z.string().nullable(),
});
export type ExtractedProfile = z.infer<typeof extractedProfileSchema>;

/** Search preferences entered by the student (never extracted). */
export const preferencesSchema = z.object({
  contract_type: contractTypeSchema.nullable(),
  rhythm: z.string().nullable(),
  start_date: z.string().nullable(), // ISO date "YYYY-MM-DD"
  target_roles: z.array(z.string()),
  target_sectors: z.array(z.string()),
  search_radius_km: z.number().int().min(0).max(1000),
});
export type Preferences = z.infer<typeof preferencesSchema>;

/** Editable profile = extracted fields + preferences (all user-editable). */
export const editableProfileSchema = extractedProfileSchema.extend(preferencesSchema.shape);
export type EditableProfile = z.infer<typeof editableProfileSchema>;

export const EXTRACTED_FIELDS = Object.keys(
  extractedProfileSchema.shape,
) as (keyof ExtractedProfile)[];

/** CV upload constraints (SPEC §5.1). */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_MIN_TEXT_CHARS = 200;
export const cvStoragePath = (userId: string) => `${userId}/cv.pdf`;
export const CV_BUCKET = "cvs";
