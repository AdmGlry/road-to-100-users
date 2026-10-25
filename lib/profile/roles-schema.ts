/**
 * "Métiers suggérés" (coach d'orientation, Sprint 1.5) — data contract and
 * pure helpers. No I/O and no LLM import: safe to use from client components
 * (components/profile/role-suggestions.tsx), the server actions and
 * lib/profile/roles.ts. Unit-tested in tests/profile-roles*.test.ts.
 */
import { z } from "zod";

import { normalizeForMatch } from "./grounding";

export const FIT_LEVELS = ["fort", "moyen", "à explorer"] as const;
export type RoleFit = (typeof FIT_LEVELS)[number];

export const MAX_ROLES = 6;
export const MAX_REASONS = 3;
export const MAX_SECTORS_PER_ROLE = 3;
export const MAX_QUESTIONS = 3;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
/** Answers accumulated over successive "Affiner" rounds. */
export const MAX_ANSWERS = 9;
export const MAX_ANSWER_QUESTION_CHARS = 300;
export const MAX_ANSWER_CHARS = 120;
/** Same limits as the profile tag inputs (components/profile/profile-utils.ts). */
export const MAX_TARGETS = 30;
export const MAX_TARGET_LENGTH = 80;

/** Accepts "fort" / "Moyen" / "a explorer" / "À explorer"… and returns the canonical label. */
function canonicalFit(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = normalizeForMatch(value);
  return FIT_LEVELS.find((f) => normalizeForMatch(f) === key) ?? value;
}

export const roleFitSchema = z.preprocess(canonicalFit, z.enum(FIT_LEVELS));

// ---------------------------------------------------------------------------
// LLM output (prompt `suggest_roles`). Lenient on counts — lib/profile/roles.ts
// trims, dedupes and caps the lists after validation.

export const llmRoleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  fit: roleFitSchema,
  why: z.array(z.string()).max(8),
  gap: z.string().nullable(),
  sectors: z.array(z.string()).max(8),
});

export const llmQuestionSchema = z.object({
  id: z.string(),
  question: z.string().trim().min(1).max(MAX_ANSWER_QUESTION_CHARS),
  options: z.array(z.string()).max(8),
});

export const suggestRolesOutputSchema = z.object({
  roles: z.array(llmRoleSchema).min(1).max(12),
  questions: z.array(llmQuestionSchema).max(6),
  summary: z.string(),
});
export type SuggestRolesOutput = z.infer<typeof suggestRolesOutputSchema>;

// ---------------------------------------------------------------------------
// What the app stores (profiles.role_suggestions) and shows.

export const roleSuggestionSchema = z.object({
  title: z.string(),
  fit: z.enum(FIT_LEVELS),
  why: z.array(z.string()),
  gap: z.string().nullable(),
  sectors: z.array(z.string()),
  alreadyTargeted: z.boolean(),
});
export type RoleSuggestion = z.infer<typeof roleSuggestionSchema>;

export const roleQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()),
});
export type RoleQuestion = z.infer<typeof roleQuestionSchema>;

export const roleAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type RoleAnswer = z.infer<typeof roleAnswerSchema>;

export const roleSuggestionsSchema = z.object({
  promptVersion: z.string(),
  generatedAt: z.string().nullable(),
  roles: z.array(roleSuggestionSchema),
  questions: z.array(roleQuestionSchema),
  summary: z.string(),
  /** The student's answers that produced these suggestions (shown as their chat bubbles). */
  answers: z.array(roleAnswerSchema),
});
export type RoleSuggestions = z.infer<typeof roleSuggestionsSchema>;

/**
 * Student answers sent to `suggestRoles`: question text → chosen option.
 * Keyed by the question TEXT (not the model's id, which is not stable between rounds).
 */
export const roleAnswersSchema = z
  .record(
    z.string().trim().min(1).max(MAX_ANSWER_QUESTION_CHARS),
    z.string().trim().min(1).max(MAX_ANSWER_CHARS),
  )
  .refine((r) => Object.keys(r).length <= MAX_ANSWERS, {
    message: `At most ${MAX_ANSWERS} answers`,
  });

export function answersToList(answers: Record<string, string> | undefined): RoleAnswer[] {
  return Object.entries(answers ?? {}).map(([question, answer]) => ({ question, answer }));
}

export function answersToRecord(list: readonly RoleAnswer[]): Record<string, string> {
  return Object.fromEntries(list.map((a) => [a.question, a.answer]));
}

/**
 * Answers to send for an "Affiner" round: the previous answers followed by
 * the new choices (a re-answered question keeps its latest choice and moves
 * last). Keeps the MAX_ANSWERS most recent; empty choices are ignored.
 */
export function mergeAnswers(
  previous: readonly RoleAnswer[],
  selected: Readonly<Record<string, string>>,
): Record<string, string> {
  const list: RoleAnswer[] = previous.filter(
    (a) => !Object.prototype.hasOwnProperty.call(selected, a.question) || !selected[a.question],
  );
  for (const [question, answer] of Object.entries(selected)) {
    if (answer && answer.trim()) list.push({ question, answer });
  }
  return answersToRecord(list.slice(-MAX_ANSWERS));
}

// ---------------------------------------------------------------------------
// Helpers

/** Comparison key for job titles / sectors: case-, accent- and punctuation-insensitive. */
export function titleKey(value: string): string {
  return normalizeForMatch(value);
}

/** Re-computes `alreadyTargeted` against the profile's current target roles. */
export function markTargeted(
  suggestions: RoleSuggestions,
  targetRoles: readonly string[],
): RoleSuggestions {
  const targeted = new Set(targetRoles.map(titleKey));
  return {
    ...suggestions,
    roles: suggestions.roles.map((r) => ({
      ...r,
      alreadyTargeted: targeted.has(titleKey(r.title)),
    })),
  };
}

function cleanTag(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TARGET_LENGTH);
}

/** Appends `values` to `list`: cleaned, deduplicated (existing spelling wins), capped. */
function appendUnique(
  list: readonly string[],
  values: readonly string[],
  max: number,
): { list: string[]; added: number; overflow: number } {
  const next = [...list];
  const seen = new Set(list.map(titleKey));
  let added = 0;
  let overflow = 0;
  for (const raw of values) {
    const value = cleanTag(raw);
    const key = titleKey(value);
    if (!value || !key || seen.has(key)) continue;
    if (next.length >= max) {
      overflow += 1;
      continue;
    }
    seen.add(key);
    next.push(value);
    added += 1;
  }
  return { list: next, added, overflow };
}

export type MergeTargetsResult = {
  targetRoles: string[];
  targetSectors: string[];
  /** The role was already in target_roles (nothing to add). */
  roleAlreadyPresent: boolean;
  /** The role could not be added because target_roles is full. */
  roleListFull: boolean;
  changed: boolean;
};

/**
 * Adds a suggested role to target_roles and its sectors to target_sectors
 * (deduplicated case/accent-insensitively, max MAX_TARGETS each). Sectors are
 * only added when the role itself is (or already was) in the list.
 */
export function mergeTargets(
  targetRoles: readonly string[],
  targetSectors: readonly string[],
  title: string,
  sectors: readonly string[],
): MergeTargetsResult {
  const roleKey = titleKey(cleanTag(title));
  const roleAlreadyPresent = targetRoles.some((r) => titleKey(r) === roleKey);
  const roles = appendUnique(targetRoles, [title], MAX_TARGETS);
  const roleListFull = !roleAlreadyPresent && roles.overflow > 0;
  const secs = roleListFull
    ? { list: [...targetSectors], added: 0 }
    : appendUnique(targetSectors, sectors, MAX_TARGETS);
  return {
    targetRoles: roles.list,
    targetSectors: secs.list,
    roleAlreadyPresent,
    roleListFull,
    changed: roles.added > 0 || secs.added > 0,
  };
}

/** French label of a fit level (shown as text, never colour-only). */
export const FIT_LABELS: Record<RoleFit, string> = {
  fort: "Correspondance forte",
  moyen: "Correspondance moyenne",
  "à explorer": "Piste à explorer",
};
