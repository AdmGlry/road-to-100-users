/**
 * "Métiers suggérés" — the coach d'orientation (Sprint 1.5). SERVER ONLY.
 *
 * Loads the signed-in student's profile (RLS applies: the Supabase client acts
 * as the user), asks the LLM (prompt `suggest_roles`) for realistic job titles,
 * then post-validates the answer deterministically:
 * - titles deduplicated case/accent-insensitively, max 6 roles;
 * - every `why` reason must share at least one significant word with the
 *   profile, otherwise it is dropped (anti-hallucination guard);
 * - roles already in target_roles are kept and flagged `alreadyTargeted`.
 * The result is stored in `profiles.role_suggestions` so it survives reloads.
 *
 * Never logs profile values or model output — only counts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import { generateJson, type LlmProvider } from "@/lib/llm/client";
import {
  buildSuggestRolesPrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
  toRoleProfileSummary,
} from "@/lib/llm/prompts/suggest-roles";

import { normalizeForMatch } from "./grounding";
import {
  answersToList,
  markTargeted,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_REASONS,
  MAX_ROLES,
  MAX_SECTORS_PER_ROLE,
  MAX_TARGET_LENGTH,
  MIN_OPTIONS,
  roleAnswersSchema,
  roleSuggestionsSchema,
  titleKey,
  type RoleAnswer,
  type RoleQuestion,
  type RoleSuggestion,
  type RoleSuggestions,
  type SuggestRolesOutput,
} from "./roles-schema";
import type { EditableProfile } from "./schema";
import { loadEditableProfile } from "./service";

export type {
  RoleAnswer,
  RoleFit,
  RoleQuestion,
  RoleSuggestion,
  RoleSuggestions,
} from "./roles-schema";

export const FALLBACK_REASON = "Rôle proche de ton parcours";
const FALLBACK_SUMMARY = "Voici des métiers qui correspondent à ton profil. Regarde-les un par un.";
const MAX_SUMMARY_CHARS = 600;
const MAX_TEXT_CHARS = 300;

export type RoleSuggestionErrorCode = "profile_incomplete" | "invalid_answers" | "llm_failed";

const USER_MESSAGES: Record<RoleSuggestionErrorCode, string> = {
  profile_incomplete: "Importe ou complète ton CV d'abord",
  invalid_answers: "Tes réponses n'ont pas pu être lues. Réessaie.",
  llm_failed: "Le coach n'a pas réussi à analyser ton profil. Réessaie dans un instant.",
};

/** Typed error with a French message that can be shown to the student as is. */
export class RoleSuggestionError extends Error {
  readonly code: RoleSuggestionErrorCode;
  readonly userMessage: string;

  constructor(code: RoleSuggestionErrorCode, options?: { cause?: unknown }) {
    super(`suggest_roles failed: ${code}`, options);
    this.name = "RoleSuggestionError";
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

// ---------------------------------------------------------------------------
// Grounding of `why`

/** Generic words (normalised, ≥ 4 letters) that prove nothing about the profile. */
const GENERIC_WORDS = new Set([
  "ainsi",
  "atout",
  "atouts",
  "aussi",
  "autre",
  "autres",
  "avant",
  "avec",
  "avoir",
  "base",
  "bases",
  "bien",
  "bonne",
  "bonnes",
  "capacite",
  "capacites",
  "cette",
  "chez",
  "comme",
  "competence",
  "competences",
  "connaissance",
  "connaissances",
  "dans",
  "deja",
  "demontre",
  "domaine",
  "domaines",
  "elle",
  "entre",
  "entreprise",
  "entreprises",
  "etre",
  "experience",
  "experiences",
  "fait",
  "faire",
  "forte",
  "interet",
  "maitrise",
  "metier",
  "metiers",
  "mettre",
  "montre",
  "notamment",
  "notre",
  "parcours",
  "permet",
  "pertinent",
  "pertinente",
  "pertinentes",
  "pertinents",
  "peut",
  "plus",
  "pour",
  "poste",
  "postes",
  "profil",
  "role",
  "roles",
  "solide",
  "solides",
  "sont",
  "sous",
  "toute",
  "toutes",
  "tous",
  "tout",
  "travail",
  "tres",
  "utile",
  "utiles",
  "valoriser",
  "votre",
]);

const MIN_TOKEN_LENGTH = 4;

function stem(token: string): string {
  return token.length > MIN_TOKEN_LENGTH && /[sx]$/.test(token) ? token.slice(0, -1) : token;
}

/** Significant tokens: ≥ 4 characters, accent-insensitive, generic words removed. */
export function significantReasonTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !GENERIC_WORDS.has(t));
}

/** All the profile text the model was given (same fields as the prompt summary). */
export function profileTextForGrounding(profile: EditableProfile): string {
  const s = toRoleProfileSummary(profile);
  return [
    s.degree,
    s.school,
    s.city,
    s.contract_type,
    s.rhythm,
    ...s.skills,
    ...s.experiences.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...s.education.flatMap((e) => [e.degree, e.school]),
    ...s.languages.flatMap((l) => [l.language, l.level]),
    ...s.target_roles,
    ...s.target_sectors,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");
}

export class ProfileTokenIndex {
  private readonly tokens: Set<string>;

  constructor(profileText: string) {
    this.tokens = new Set(
      normalizeForMatch(profileText)
        .split(" ")
        .filter((t) => t.length >= MIN_TOKEN_LENGTH)
        .map(stem),
    );
  }

  /** True when at least one significant token of `reason` appears in the profile. */
  supports(reason: string): boolean {
    return significantReasonTokens(reason).some((t) => this.tokens.has(stem(t)));
  }
}

// ---------------------------------------------------------------------------
// Post-validation (pure)

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

function uniqueClean(values: readonly string[], max: number, maxChars = MAX_TEXT_CHARS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = collapse(raw).slice(0, maxChars);
    const key = titleKey(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export type PostProcessStats = { droppedReasons: number; droppedRoles: number };

/**
 * Turns the raw model output into what the app shows and stores. Pure
 * (exported for tests). `answers` are the student's answers for this round.
 */
export function postProcessSuggestions(
  output: SuggestRolesOutput,
  profile: EditableProfile,
  answers: readonly RoleAnswer[],
  generatedAt: string,
): { suggestions: RoleSuggestions; stats: PostProcessStats } {
  const index = new ProfileTokenIndex(profileTextForGrounding(profile));
  const targeted = new Set(profile.target_roles.map(titleKey));
  let droppedReasons = 0;
  let droppedRoles = 0;

  const roles: RoleSuggestion[] = [];
  const seenTitles = new Set<string>();
  for (const role of output.roles) {
    const title = collapse(role.title).slice(0, MAX_TARGET_LENGTH);
    const key = titleKey(title);
    if (!title || !key || seenTitles.has(key) || roles.length >= MAX_ROLES) {
      droppedRoles += 1;
      continue;
    }
    seenTitles.add(key);

    const reasons = uniqueClean(role.why, Number.MAX_SAFE_INTEGER);
    const grounded = reasons.filter((r) => index.supports(r));
    droppedReasons += reasons.length - grounded.length;
    const gap = role.gap === null ? "" : collapse(role.gap).slice(0, MAX_TEXT_CHARS);

    roles.push({
      title,
      fit: role.fit,
      why: grounded.length > 0 ? grounded.slice(0, MAX_REASONS) : [FALLBACK_REASON],
      gap: gap || null,
      sectors: uniqueClean(role.sectors, MAX_SECTORS_PER_ROLE, MAX_TARGET_LENGTH),
      alreadyTargeted: targeted.has(key),
    });
  }

  const answered = new Set(answers.map((a) => normalizeForMatch(a.question)));
  const questions: RoleQuestion[] = [];
  const seenIds = new Set<string>();
  const seenQuestions = new Set<string>();
  for (const q of output.questions) {
    const question = collapse(q.question);
    const qKey = normalizeForMatch(question);
    if (!qKey || answered.has(qKey) || seenQuestions.has(qKey)) continue;
    const options = uniqueClean(q.options, MAX_OPTIONS, 80);
    if (options.length < MIN_OPTIONS) continue;
    let id = normalizeForMatch(q.id).replace(/ /g, "_").slice(0, 40) || `q${questions.length + 1}`;
    while (seenIds.has(id)) id = `${id}_${questions.length + 1}`;
    seenIds.add(id);
    seenQuestions.add(qKey);
    questions.push({ id, question, options });
    if (questions.length >= MAX_QUESTIONS) break;
  }

  const summary = collapse(output.summary).slice(0, MAX_SUMMARY_CHARS) || FALLBACK_SUMMARY;

  return {
    suggestions: {
      promptVersion: PROMPT_VERSION,
      generatedAt,
      roles,
      questions,
      summary,
      answers: [...answers],
    },
    stats: { droppedReasons, droppedRoles },
  };
}

/** The coach needs at least one of: skills, experiences, degree. */
export function hasEnoughForSuggestions(profile: EditableProfile): boolean {
  return (
    profile.skills.some((s) => s.trim() !== "") ||
    profile.experiences.some((e) => e.title.trim() !== "") ||
    (profile.degree ?? "").trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// Public API

export type SuggestRolesOptions = {
  /** Override the configured LLM provider (tests). */
  provider?: LlmProvider;
  /** Clock override (tests). */
  now?: () => Date;
};

/**
 * Generates, stores and returns role suggestions for the signed-in user.
 * `answers`: question text → chosen option (all answers given so far).
 * Throws RoleSuggestionError (profile_incomplete | invalid_answers | llm_failed);
 * other errors are database failures.
 */
export async function suggestRoles(
  supabase: SupabaseClient,
  userId: string,
  answers?: Record<string, string>,
  opts: SuggestRolesOptions = {},
): Promise<RoleSuggestions> {
  const parsedAnswers = roleAnswersSchema.safeParse(answers ?? {});
  if (!parsedAnswers.success) throw new RoleSuggestionError("invalid_answers");
  const answerList = answersToList(parsedAnswers.data);

  const { profile } = await loadEditableProfile(supabase, userId);
  if (!hasEnoughForSuggestions(profile)) throw new RoleSuggestionError("profile_incomplete");

  const { system, prompt } = buildSuggestRolesPrompt(profile, answerList);
  let output: SuggestRolesOutput;
  try {
    ({ data: output } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: opts.provider,
      onUsage: (usage) =>
        logEvent(supabase, userId, "llm_usage", {
          prompt: usage.promptName,
          prompt_version: usage.promptVersion,
          model: usage.model,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          attempts: usage.attempts,
          success: usage.success,
        }),
    }));
  } catch (cause) {
    // Invalid JSON after the retry, provider outage or missing LLM configuration.
    throw new RoleSuggestionError("llm_failed", { cause });
  }

  const now = (opts.now ?? (() => new Date()))().toISOString();
  const { suggestions, stats } = postProcessSuggestions(output, profile, answerList, now);

  const { error } = await supabase
    .from("profiles")
    .update({ role_suggestions: suggestions, role_suggestions_at: now })
    .eq("user_id", userId);
  if (error) {
    // Not fatal: the student still sees the suggestions, they just won't survive a reload.
    console.warn(`[roles] storing suggestions failed (${error.code ?? "unknown"})`);
  }

  await logEvent(supabase, userId, "roles_suggested", {
    prompt_version: PROMPT_VERSION,
    roles: suggestions.roles.length,
    questions: suggestions.questions.length,
    answers: answerList.length,
    already_targeted: suggestions.roles.filter((r) => r.alreadyTargeted).length,
    dropped_reasons: stats.droppedReasons,
    dropped_roles: stats.droppedRoles,
  });

  return suggestions;
}

/**
 * Last stored suggestions (or null), with `alreadyTargeted` refreshed against
 * the current target_roles. Never throws: the profile page must render even
 * if the column is missing or holds invalid data.
 */
export async function loadRoleSuggestions(
  supabase: SupabaseClient,
  userId: string,
): Promise<RoleSuggestions | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role_suggestions, target_roles")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn(`[roles] loading suggestions failed (${error.code ?? "unknown"})`);
      return null;
    }
    const row = (data ?? null) as { role_suggestions?: unknown; target_roles?: unknown } | null;
    if (!row || row.role_suggestions == null) return null;
    const parsed = roleSuggestionsSchema.safeParse(row.role_suggestions);
    if (!parsed.success) return null;
    const targetRoles = Array.isArray(row.target_roles)
      ? row.target_roles.filter((r): r is string => typeof r === "string")
      : [];
    return markTargeted(parsed.data, targetRoles);
  } catch {
    console.warn("[roles] loading suggestions threw");
    return null;
  }
}
