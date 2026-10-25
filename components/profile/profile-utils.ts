/**
 * Pure helpers for the profile UI and server actions (no React, no I/O):
 * tag editing, normalization before save, autosave patch diff, CV-change
 * formatting. Unit-tested in tests/profile-utils.test.ts.
 */
import {
  EXTRACTED_FIELDS,
  type ContractType,
  type EditableProfile,
  type Education,
  type Experience,
  type ExtractedProfile,
  type Language,
} from "@/lib/profile/schema";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 80;

/**
 * Adds the comma-separated values of `input` to `tags`: trimmed, collapsed
 * whitespace, deduplicated case-insensitively (existing spelling wins),
 * capped at `max`. Returns the new list and how many values were dropped
 * because the list was full.
 */
export function addTags(
  tags: readonly string[],
  input: string,
  max: number = MAX_TAGS,
): { tags: string[]; overflow: number } {
  const next = [...tags];
  const seen = new Set(tags.map((t) => t.toLocaleLowerCase("fr")));
  let overflow = 0;
  for (const raw of input.split(",")) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    if (next.length >= max) {
      overflow += 1;
      continue;
    }
    seen.add(key);
    next.push(tag);
  }
  return { tags: next, overflow };
}

export function removeTagAt(tags: readonly string[], index: number): string[] {
  return tags.filter((_, i) => i !== index);
}

// ---------------------------------------------------------------------------
// Normalization (what is actually sent to the server)
// ---------------------------------------------------------------------------

const cleanText = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

const cleanList = (values: readonly string[]): string[] =>
  values.map((v) => v.trim()).filter((v) => v !== "");

function normalizeExperience(e: Experience): Experience | null {
  const item: Experience = {
    title: (e.title ?? "").trim(),
    company: cleanText(e.company),
    start: cleanText(e.start),
    end: cleanText(e.end),
    bullets: cleanList(e.bullets),
  };
  const empty = !item.title && !item.company && !item.start && !item.end && !item.bullets.length;
  return empty ? null : item;
}

function normalizeEducation(e: Education): Education | null {
  const item: Education = {
    degree: (e.degree ?? "").trim(),
    school: cleanText(e.school),
    start: cleanText(e.start),
    end: cleanText(e.end),
  };
  return !item.degree && !item.school && !item.start && !item.end ? null : item;
}

function normalizeLanguage(l: Language): Language | null {
  const item: Language = { language: (l.language ?? "").trim(), level: cleanText(l.level) };
  return !item.language && !item.level ? null : item;
}

const notNull = <T>(v: T | null): v is T => v !== null;

/**
 * Canonical form of the profile as stored: trimmed strings, "" → null,
 * empty list rows dropped. The form keeps the raw values (so typing a
 * trailing space or adding a blank row works), and only the normalized
 * value is compared and saved.
 */
export function normalizeProfile(p: EditableProfile): EditableProfile {
  return {
    full_name: cleanText(p.full_name),
    email: cleanText(p.email),
    phone: cleanText(p.phone),
    city: cleanText(p.city),
    school: cleanText(p.school),
    degree: cleanText(p.degree),
    skills: cleanList(p.skills),
    experiences: p.experiences.map(normalizeExperience).filter(notNull),
    education: p.education.map(normalizeEducation).filter(notNull),
    languages: p.languages.map(normalizeLanguage).filter(notNull),
    pitch: cleanText(p.pitch),
    contract_type: p.contract_type,
    rhythm: cleanText(p.rhythm),
    start_date: cleanText(p.start_date),
    target_roles: cleanList(p.target_roles),
    target_sectors: cleanList(p.target_sectors),
    search_radius_km: p.search_radius_km,
  };
}

// ---------------------------------------------------------------------------
// Autosave diff
// ---------------------------------------------------------------------------

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Top-level fields of `next` that differ from `saved` (both compared in
 * normalized form). An empty object means there is nothing to save.
 */
export function diffProfile(
  saved: EditableProfile,
  next: EditableProfile,
): Partial<EditableProfile> {
  const a = normalizeProfile(saved);
  const b = normalizeProfile(next);
  const patch: Partial<EditableProfile> = {};
  for (const key of Object.keys(b) as (keyof EditableProfile)[]) {
    if (!sameValue(a[key], b[key])) {
      (patch as Record<string, unknown>)[key] = b[key];
    }
  }
  return patch;
}

export function applyPatch(
  base: EditableProfile,
  patch: Partial<EditableProfile>,
): EditableProfile {
  return { ...base, ...patch };
}

// ---------------------------------------------------------------------------
// CV extraction helpers
// ---------------------------------------------------------------------------

const isEmptyValue = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/**
 * True when none of the CV-extractable fields hold data yet (first import).
 * `email` is ignored when it only repeats the sign-in address, which may
 * have been pre-filled from the Google account.
 */
export function hasNoExtractedData(
  profile: EditableProfile,
  accountEmail?: string | null,
): boolean {
  return EXTRACTED_FIELDS.every((field) => {
    const value = profile[field];
    if (
      field === "email" &&
      typeof value === "string" &&
      accountEmail &&
      value.trim().toLowerCase() === accountEmail.trim().toLowerCase()
    ) {
      return true;
    }
    return isEmptyValue(value);
  });
}

/** The non-empty extracted fields, as a patch (first import: apply everything found). */
export function extractedToPatch(extracted: ExtractedProfile): Partial<EditableProfile> {
  const patch: Partial<EditableProfile> = {};
  for (const field of EXTRACTED_FIELDS) {
    const value = extracted[field];
    if (!isEmptyValue(value)) (patch as Record<string, unknown>)[field] = value;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Display (review dialog)
// ---------------------------------------------------------------------------

const period = (start: string | null, end: string | null): string => {
  if (start && end) return ` (${start} – ${end})`;
  if (start) return ` (depuis ${start})`;
  if (end) return ` (jusqu'à ${end})`;
  return "";
};

export function formatExperience(e: Experience): string {
  const head = [e.title?.trim() || "Sans intitulé", e.company?.trim()].filter(Boolean).join(" — ");
  return head + period(e.start, e.end);
}

export function formatEducation(e: Education): string {
  const head = [e.degree?.trim() || "Diplôme", e.school?.trim()].filter(Boolean).join(" — ");
  return head + period(e.start, e.end);
}

export function formatLanguage(l: Language): string {
  return l.level?.trim() ? `${l.language} (${l.level})` : l.language;
}

/**
 * Human-readable French lines for a profile field value: one line for a
 * scalar, one per item for a list, [] when empty.
 */
export function formatFieldValue(field: keyof ExtractedProfile, value: unknown): string[] {
  if (isEmptyValue(value)) return [];
  if (!Array.isArray(value)) return [String(value)];
  switch (field) {
    case "experiences":
      return (value as Experience[]).map(formatExperience);
    case "education":
      return (value as Education[]).map(formatEducation);
    case "languages":
      return (value as Language[]).map(formatLanguage);
    default:
      return value.map((v) => String(v));
  }
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  alternance: "Alternance",
  stage: "Stage",
  cdi: "CDI",
  cdd: "CDD",
};

/** "14:32" in French time format. */
export function formatSavedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// CV file checks (client side, before upload; the server checks again)
// ---------------------------------------------------------------------------

/** French error message for a file that cannot be a valid CV, or null. */
export function checkCvFile(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): string | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "Ce fichier n'est pas un PDF. Exporte ton CV en PDF puis réessaie.";
  if (file.size === 0) return "Ce fichier est vide. Choisis un autre PDF.";
  if (file.size > maxBytes) {
    const maxMo = Math.round(maxBytes / (1024 * 1024));
    return `Ton CV dépasse ${maxMo} Mo. Compresse-le ou exporte-le à nouveau en PDF (moins de ${maxMo} Mo).`;
  }
  return null;
}

/** True when the bytes start with the PDF signature "%PDF-". */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return signature.every((b, i) => bytes[i] === b);
}
