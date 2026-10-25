/**
 * "Remplacer mon CV" (SPEC §5.3): compare a freshly extracted profile with
 * the current (possibly hand-corrected) one and propose field-level changes.
 *
 * Nothing is overwritten silently: a change is accepted by default only when
 * the current value is empty, or when it only ADDS skills.
 * Fields the new CV does not provide (null / []) are never proposed, so a new
 * CV can't wipe data the student entered.
 */
import { normalizeForMatch } from "./grounding";
import { EXTRACTED_FIELDS, type EditableProfile, type ExtractedProfile } from "./schema";

export type FieldChange = {
  field: keyof ExtractedProfile;
  /** French label for the UI. */
  label: string;
  current: unknown;
  proposed: unknown;
  defaultAccept: boolean;
};

export const FIELD_LABELS: Record<keyof ExtractedProfile, string> = {
  full_name: "Nom complet",
  email: "E-mail",
  phone: "Téléphone",
  city: "Ville",
  school: "École",
  degree: "Diplôme",
  skills: "Compétences",
  experiences: "Expériences",
  education: "Formation",
  languages: "Langues",
  pitch: "Pitch",
};

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Canonical form for comparison: strings normalised, objects with sorted keys. */
function canonical(value: unknown): unknown {
  if (typeof value === "string") {
    const n = normalizeForMatch(value);
    return n === "" ? null : n;
  }
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** current + the new items not already present (case/accent-insensitive). */
function unionStrings(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map(normalizeForMatch));
  const result = [...current];
  for (const item of incoming) {
    const key = normalizeForMatch(item);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function proposeCvChanges(
  current: EditableProfile,
  extracted: ExtractedProfile,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of EXTRACTED_FIELDS) {
    const cur = current[field];
    const next = extracted[field];
    if (isEmpty(next)) continue;

    if (field === "skills") {
      const curList = current.skills;
      const union = unionStrings(curList, extracted.skills);
      if (union.length === curList.length) continue; // nothing new
      changes.push({
        field,
        label: FIELD_LABELS[field],
        current: [...curList],
        proposed: union,
        defaultAccept: true, // only adds items, never removes a skill
      });
      continue;
    }

    if (sameValue(cur, next)) continue;
    changes.push({
      field,
      label: FIELD_LABELS[field],
      current: structuredClone(cur),
      proposed: structuredClone(next),
      defaultAccept: isEmpty(cur),
    });
  }
  return changes;
}

/**
 * Returns a new profile with the accepted changes applied (others untouched).
 * `acceptedFields` may come straight from a form: names that match no change are ignored.
 */
export function applyCvChanges(
  current: EditableProfile,
  changes: readonly FieldChange[],
  acceptedFields: Iterable<string>,
): EditableProfile {
  const accepted = new Set<string>(acceptedFields);
  const next: EditableProfile = structuredClone(current);
  for (const change of changes) {
    if (!accepted.has(change.field) || !EXTRACTED_FIELDS.includes(change.field)) continue;
    (next as Record<string, unknown>)[change.field] = structuredClone(change.proposed);
  }
  return next;
}
