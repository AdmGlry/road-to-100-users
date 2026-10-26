/**
 * Follow-ups (SPEC §8.3). SERVER ONLY.
 *
 * - generateFollowups (cron `followups`, service role): 7 days after a send
 *   without reply, drafts ONE follow-up (prompt `compose_followup`). Drafts
 *   only: nothing is ever sent from the cron.
 * - markNoReply (cron): 21 days without reply after a follow-up → `no_reply`;
 *   drafts left unvalidated for 14 days are dismissed.
 * - updateFollowup / dismissFollowup / sendFollowup (board Server Actions,
 *   service-role client always filtered on the session user id).
 *
 * Safety rules of sendFollowup (same as lib/hunter/send.ts):
 * - the student's click IS the validation: `followup_approved_at` is set in
 *   the compare-and-swap claim `draft → sending`, which also re-checks that
 *   the application is still `sent`, never followed up and without reply;
 * - the quota slot (20 / 24 h, follow-ups included) is reserved atomically
 *   right before the Gmail call and released only when the mail certainly
 *   did not leave; a timeout keeps the slot and is NEVER resent
 *   automatically (back to draft with an "uncertain" message);
 * - a claim older than 5 minutes (crashed worker) is recovered by the cron:
 *   "uncertain" when a slot was reserved after the claim, else silently
 *   back to draft. `followup_approved_at` doubles as the claim timestamp.
 * Never logs mail contents, addresses or tokens: only error names / codes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logEvent } from "@/lib/events";
import { getValidAccessToken, GmailNotConnectedError } from "@/lib/google/connection";
import { SEND_CLAIM_STALE_MS } from "@/lib/hunter/application-types";
import { countWords, findBannedWords } from "@/lib/hunter/claims";
import { buildMimeMessage, isValidEmail, MimeError, textToHtml } from "@/lib/hunter/mime";
import {
  getThreadMetadata,
  GmailReadError,
  GmailSendError,
  sendRawMessage,
  type ThreadMessageMeta,
} from "@/lib/integrations/gmail";
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildComposeFollowupPrompt,
  FOLLOWUP_BODY_MAX_CHARS,
  followupSubject,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
  type ComposeFollowupInput,
} from "@/lib/llm/prompts/compose-followup";
import type { EditableProfile } from "@/lib/profile/schema";
import { loadEditableProfile } from "@/lib/profile/service";
import { releaseSendSlot, reserveSendSlot } from "@/lib/quotas";

import {
  FOLLOWUP_AFTER_DAYS,
  FOLLOWUP_MAX_WORDS,
  FOLLOWUP_MIN_WORDS,
  NO_REPLY_AFTER_DAYS,
} from "./types";

export { PROMPT_VERSION as FOLLOWUP_PROMPT_VERSION };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A draft not validated for this long after it was proposed is dismissed. */
export const FOLLOWUP_DRAFT_TTL_DAYS = 14;
export const FOLLOWUP_SUBJECT_MAX = 120;
export const DEFAULT_FOLLOWUP_LIMIT = 30;
export const DEFAULT_FOLLOWUP_DEADLINE_MS = 50_000;

// ---------------------------------------------------------------------------
// Errors

export type FollowupErrorCode =
  | "invalid"
  | "not_found"
  | "locked"
  | "not_sendable"
  | "in_progress"
  | "no_contact"
  | "empty"
  | "reconnect"
  | "scopes"
  | "quota"
  | "rejected"
  | "rate_limited"
  | "google_down"
  | "uncertain"
  | "internal"
  | "db";

/** French, user-facing messages (also stored in `followup_error`). */
export const FOLLOWUP_ERRORS: Record<FollowupErrorCode, string> = {
  invalid: "Certaines informations ne sont pas valides. Vérifie la relance puis réessaie.",
  not_found: "Cette relance est introuvable. Recharge la page.",
  locked:
    "Cette relance n'est plus modifiable (déjà envoyée, ignorée ou en cours d'envoi). Recharge la page.",
  not_sendable:
    "Cette relance ne peut plus être envoyée : elle est déjà partie, a été ignorée, ou une réponse est arrivée entre-temps. Recharge la page.",
  in_progress:
    "Cette relance est déjà en cours d'envoi. Patiente quelques secondes puis recharge la page.",
  no_contact: "Le destinataire de cette candidature n'a pas d'adresse valide : relance impossible.",
  empty: "L'objet ou le texte de la relance est vide : complète-le avant de l'envoyer.",
  reconnect:
    "Reconnecte ton Gmail (Paramètres) pour envoyer cette relance : elle reste en brouillon.",
  scopes:
    "Spontané n'a pas l'autorisation d'envoyer depuis ton Gmail. Reconnecte-le en cochant toutes les cases demandées.",
  quota:
    "Limite de 20 envois sur 24 h atteinte (relances comprises) : la relance reste en brouillon, réessaie plus tard.",
  rejected: "Gmail a refusé cette relance. Vérifie son texte puis réessaie.",
  rate_limited: "Gmail limite temporairement tes envois. Réessaie dans quelques minutes.",
  google_down:
    "Gmail n'a pas répondu et la relance n'est pas partie. Réessaie dans quelques minutes.",
  uncertain:
    "L'envoi de la relance a été interrompu et on ne sait pas si elle est partie. Regarde dans « Messages envoyés » de ton Gmail avant de la renvoyer.",
  internal: "L'envoi de la relance a échoué à cause d'une erreur de notre côté. Réessaie.",
  db: "Ton changement n'a pas été enregistré. Vérifie ta connexion puis réessaie.",
};

export class FollowupError extends Error {
  readonly code: FollowupErrorCode;
  /** French, safe to show to the student. */
  readonly userMessage: string;
  constructor(code: FollowupErrorCode, options?: { cause?: unknown }) {
    super(`followup: ${code}`, options);
    this.name = "FollowupError";
    this.code = code;
    this.userMessage = FOLLOWUP_ERRORS[code];
  }
}

function logFailure(step: string, err: unknown) {
  const extra: Record<string, unknown> = { name: err instanceof Error ? err.name : typeof err };
  if (err instanceof GmailSendError || err instanceof GmailReadError) {
    extra.status = err.status;
    extra.reason = err.reason;
  } else if (err && typeof err === "object" && "code" in err) {
    extra.code = String((err as { code: unknown }).code);
  }
  console.error(`[followups] ${step} failed`, extra);
}

const dbError = (what: string, error: { code?: string } | null) => {
  logFailure(what, error ?? {});
  return new FollowupError("db");
};

// ---------------------------------------------------------------------------
// Dependencies

export type FollowupDeps = {
  getValidAccessToken: (
    admin: SupabaseClient,
    userId: string,
  ) => Promise<{ accessToken: string; email: string }>;
  getThreadMetadata: (accessToken: string, threadId: string) => Promise<ThreadMessageMeta[]>;
  sendRawMessage: (
    accessToken: string,
    raw: string,
    opts: { threadId?: string },
  ) => Promise<{ id: string; threadId: string }>;
  reserveSendSlot: typeof reserveSendSlot;
  releaseSendSlot: typeof releaseSendSlot;
  logEvent: typeof logEvent;
  loadProfile: (admin: SupabaseClient, userId: string) => Promise<EditableProfile>;
  /** LLM provider override (tests). */
  provider?: LlmProvider;
};

const defaultDeps: FollowupDeps = {
  getValidAccessToken: (admin, userId) => getValidAccessToken(admin, userId),
  getThreadMetadata,
  sendRawMessage,
  reserveSendSlot,
  releaseSendSlot,
  logEvent,
  loadProfile: async (admin, userId) => (await loadEditableProfile(admin, userId)).profile,
};

// ---------------------------------------------------------------------------
// Composition (prompt compose_followup + checks)

export type FollowupProblem = { code: "word_count" | "banned_words"; message: string };

/** Quality problems of a generated follow-up body (French messages). */
export function analyzeFollowup(body: string): FollowupProblem[] {
  const problems: FollowupProblem[] = [];
  const words = countWords(body);
  if (words < FOLLOWUP_MIN_WORDS || words > FOLLOWUP_MAX_WORDS) {
    problems.push({
      code: "word_count",
      message: `La relance fait ${words} mots (attendu : ${FOLLOWUP_MIN_WORDS} à ${FOLLOWUP_MAX_WORDS}).`,
    });
  }
  const banned = findBannedWords(body);
  if (banned.length > 0) {
    problems.push({
      code: "banned_words",
      message: `Formules creuses à éviter : ${banned.join(", ")}.`,
    });
  }
  return problems;
}

/**
 * Generates the follow-up body; one regeneration when the first attempt has
 * problems. Returns the better attempt with the problems left (French).
 * Throws when no attempt produced a valid JSON answer.
 */
export async function composeFollowup(
  input: Omit<ComposeFollowupInput, "problems">,
  deps: { provider?: LlmProvider; onUsage?: (e: LlmUsageEvent) => void | Promise<void> } = {},
): Promise<{ body: string; problems: string[]; regenerated: boolean }> {
  const generate = async (problems?: string[]) => {
    const { system, prompt } = buildComposeFollowupPrompt({ ...input, problems });
    const { data } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: deps.provider,
      onUsage: deps.onUsage,
    });
    return data.body;
  };

  const firstBody = await generate();
  let best = { body: firstBody, problems: analyzeFollowup(firstBody) };
  let regenerated = false;
  if (best.problems.length > 0) {
    regenerated = true;
    try {
      const second = await generate(best.problems.map((p) => p.message));
      const problems = analyzeFollowup(second);
      if (problems.length <= best.problems.length) best = { body: second, problems };
    } catch (e) {
      console.warn(`[followups] regeneration failed (${e instanceof Error ? e.name : "unknown"})`);
    }
  }
  return { body: best.body, problems: best.problems.map((p) => p.message), regenerated };
}

// ---------------------------------------------------------------------------
// generateFollowups (cron)

type CandidateRow = {
  id: string;
  user_id: string;
  lead_id: string;
  contact_id: string | null;
  subject: string | null;
  body: string | null;
};

type SendingRow = { id: string; user_id: string; followup_approved_at: string | null };

/** Stale `sending` claims (crashed worker): never resent, back to draft. */
async function recoverStaleClaims(admin: SupabaseClient, now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - SEND_CLAIM_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("applications")
    .select("id, user_id, followup_approved_at")
    .eq("followup_status", "sending")
    .lte("followup_approved_at", staleBefore)
    .limit(100);
  if (error) {
    logFailure("stale claims select", error);
    return 0;
  }
  let recovered = 0;
  for (const row of (data ?? []) as SendingRow[]) {
    if (!row.followup_approved_at) continue;
    try {
      // A slot reserved after the claim (1 min margin for clock skew) means
      // the follow-up may have left.
      const since = new Date(Date.parse(row.followup_approved_at) - 60_000).toISOString();
      const { data: slots, error: slotError } = await admin
        .from("send_log")
        .select("id")
        .eq("user_id", row.user_id)
        .eq("application_id", row.id)
        .gte("sent_at", since)
        .limit(1);
      if (slotError) throw slotError;
      const uncertain = Array.isArray(slots) && slots.length > 0;
      const { error: updateError } = await admin
        .from("applications")
        .update({
          followup_status: "draft",
          followup_approved_at: null,
          followup_error: uncertain ? FOLLOWUP_ERRORS.uncertain : null,
        })
        .eq("id", row.id)
        .eq("user_id", row.user_id)
        .eq("followup_status", "sending")
        .eq("followup_approved_at", row.followup_approved_at);
      if (updateError) throw updateError;
      recovered++;
    } catch (err) {
      logFailure("stale claim recovery", err);
    }
  }
  return recovered;
}

export type GenerateFollowupsOptions = {
  now?: () => Date;
  /** Do not start a new draft after this many ms. */
  deadlineMs?: number;
  /** Max drafts attempted per run. */
  limit?: number;
  deps?: Partial<FollowupDeps>;
};

/** Drafts the due follow-ups. Throws only if the candidates cannot be read. */
export async function generateFollowups(
  admin: SupabaseClient,
  opts: GenerateFollowupsOptions = {},
): Promise<{ drafted: number; failed: number }> {
  const deps: FollowupDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? (() => new Date());
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_FOLLOWUP_DEADLINE_MS;
  const limit = Math.max(0, opts.limit ?? DEFAULT_FOLLOWUP_LIMIT);
  const counts = { drafted: 0, failed: 0 };

  await recoverStaleClaims(admin, now());

  const cutoff = new Date(now().getTime() - FOLLOWUP_AFTER_DAYS * DAY_MS).toISOString();
  const { data, error } = await admin
    .from("applications")
    .select("id, user_id, lead_id, contact_id, subject, body")
    .eq("status", "sent")
    .eq("followup_count", 0)
    .is("followup_status", null)
    .is("last_reply_at", null)
    .eq("status_set_manually", false)
    .not("gmail_thread_id", "is", null)
    .lte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`followup candidates select failed (${error.code ?? "unknown"})`);
  const rows = (data ?? []) as CandidateRow[];
  if (rows.length === 0 || limit === 0) return counts;

  // Only students whose Gmail connection is active (the draft must be sendable).
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: conns, error: connError } = await admin
    .from("google_connections")
    .select("user_id, status")
    .in("user_id", userIds);
  if (connError) throw new Error(`google_connections select failed (${connError.code ?? ""})`);
  const active = new Set(
    ((conns ?? []) as { user_id: string; status: string }[])
      .filter((c) => c.status === "active")
      .map((c) => c.user_id),
  );
  const todo = rows.filter((r) => active.has(r.user_id)).slice(0, limit);

  const profiles = new Map<string, EditableProfile | null>();
  for (const row of todo) {
    if (Date.now() - startedAt > deadlineMs) break;
    try {
      const outcome = await draftOne(admin, row, deps, profiles);
      if (outcome === "drafted") counts.drafted++;
      else if (outcome === "failed") counts.failed++;
    } catch (err) {
      logFailure("draft", err);
      counts.failed++;
    }
  }
  return counts;
}

async function draftOne(
  admin: SupabaseClient,
  row: CandidateRow,
  deps: FollowupDeps,
  profiles: Map<string, EditableProfile | null>,
): Promise<"drafted" | "failed" | "skipped"> {
  const userId = row.user_id;
  const subject = (row.subject ?? "").trim();
  const body = (row.body ?? "").trim();
  if (!subject || !body) return "failed";

  if (!profiles.has(userId)) {
    try {
      profiles.set(userId, await deps.loadProfile(admin, userId));
    } catch (err) {
      logFailure("profile load", err);
      profiles.set(userId, null);
    }
  }
  const profile = profiles.get(userId);
  const fullName = profile?.full_name?.trim();
  if (!profile || !fullName) return "failed";

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("company_id")
    .eq("id", row.lead_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (leadError) throw leadError;
  const companyId = (lead as { company_id?: string } | null)?.company_id;
  let companyName = "";
  if (companyId) {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    companyName = (company as { name?: string } | null)?.name ?? "";
  }

  let contact: ComposeFollowupInput["contact"] = null;
  if (row.contact_id) {
    const { data: c, error: contactError } = await admin
      .from("contacts")
      .select("first_name, last_name")
      .eq("id", row.contact_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactError) throw contactError;
    const cr = c as { first_name?: string | null; last_name?: string | null } | null;
    if (cr) contact = { first_name: cr.first_name ?? null, last_name: cr.last_name ?? null };
  }

  const onUsage = (usage: LlmUsageEvent) =>
    deps.logEvent(admin, userId, "llm_usage", {
      prompt: usage.promptName,
      prompt_version: usage.promptVersion,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      attempts: usage.attempts,
      success: usage.success,
    });

  const composed = await composeFollowup(
    {
      original: { subject, body },
      company: { name: companyName || "l'entreprise" },
      contact,
      student: { full_name: fullName, degree: profile.degree, school: profile.school },
    },
    { provider: deps.provider, onUsage },
  );

  const warning =
    composed.problems.length > 0
      ? `À relire avant l'envoi : ${composed.problems.join(" ")}`.slice(0, 500)
      : null;
  const { data: stored, error: storeError } = await admin
    .from("applications")
    .update({
      followup_subject: followupSubject(subject).slice(0, FOLLOWUP_SUBJECT_MAX),
      followup_body: composed.body.slice(0, FOLLOWUP_BODY_MAX_CHARS),
      followup_status: "draft",
      followup_error: warning,
      followup_approved_at: null,
    })
    .eq("id", row.id)
    .eq("user_id", userId)
    .eq("status", "sent")
    .eq("followup_count", 0)
    .is("followup_status", null)
    .is("last_reply_at", null)
    .select("id");
  if (storeError) throw storeError;
  if (!Array.isArray(stored) || stored.length !== 1) return "skipped";

  await deps.logEvent(admin, userId, "followup_drafted", {
    prompt_version: PROMPT_VERSION,
    regenerated: composed.regenerated,
    warnings: composed.problems.length,
  });
  return "drafted";
}

// ---------------------------------------------------------------------------
// markNoReply (cron)

/**
 * `sent` + followed up + no reply 21 days after the send (not moved by the
 * student) → `no_reply`. Also dismisses drafts left unvalidated for 14 days.
 * Returns the number of applications marked `no_reply`.
 */
export async function markNoReply(
  admin: SupabaseClient,
  opts: { now?: () => Date } = {},
): Promise<number> {
  const now = (opts.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - NO_REPLY_AFTER_DAYS * DAY_MS).toISOString();

  const { data, error } = await admin
    .from("applications")
    .update({ status: "no_reply" })
    .eq("status", "sent")
    .gte("followup_count", 1)
    .is("last_reply_at", null)
    .eq("status_set_manually", false)
    .lte("sent_at", cutoff)
    .select("id");
  if (error) throw new Error(`no_reply update failed (${error.code ?? "unknown"})`);

  const draftCutoff = new Date(
    now.getTime() - (FOLLOWUP_AFTER_DAYS + FOLLOWUP_DRAFT_TTL_DAYS) * DAY_MS,
  ).toISOString();
  const { error: dismissError } = await admin
    .from("applications")
    .update({ followup_status: "dismissed", followup_approved_at: null })
    .eq("followup_status", "draft")
    .lte("sent_at", draftCutoff);
  if (dismissError) logFailure("stale drafts dismiss", dismissError);

  return Array.isArray(data) ? data.length : 0;
}

// ---------------------------------------------------------------------------
// Board mutations

const idSchema = z.uuid();

const updateSchema = z.object({
  subject: z
    .string()
    .refine((v) => !/[\r\n\0]/.test(v), "Pas de retour à la ligne dans l'objet.")
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(FOLLOWUP_SUBJECT_MAX))
    .optional(),
  body: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1).max(FOLLOWUP_BODY_MAX_CHARS)),
});

type FollowupRow = {
  id: string;
  followup_status: string | null;
  followup_error: string | null;
};

async function loadFollowupRow(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<FollowupRow> {
  if (!idSchema.safeParse(applicationId).success) throw new FollowupError("not_found");
  const { data, error } = await admin
    .from("applications")
    .select("id, followup_status, followup_error")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("applications select", error);
  if (!data) throw new FollowupError("not_found");
  return data as FollowupRow;
}

/** Saves the student's edits of a follow-up draft (clears its validation). */
export async function updateFollowup(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
  input: { subject?: string; body: string },
): Promise<{ subject: string | null; body: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new FollowupError("invalid");
  const row = await loadFollowupRow(admin, userId, applicationId);
  if (row.followup_status !== "draft") throw new FollowupError("locked");

  const patch: Record<string, unknown> = {
    followup_body: parsed.data.body,
    followup_approved_at: null,
  };
  if (parsed.data.subject !== undefined) patch.followup_subject = parsed.data.subject;
  // Quality warnings are obsolete once edited; the "uncertain" one is kept.
  if (row.followup_error !== FOLLOWUP_ERRORS.uncertain) patch.followup_error = null;

  const { data, error } = await admin
    .from("applications")
    .update(patch)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("followup_status", "draft")
    .select("id, followup_subject, followup_body");
  if (error) throw dbError("followup update", error);
  if (!Array.isArray(data) || data.length !== 1) throw new FollowupError("locked");
  const saved = data[0] as { followup_subject: string | null; followup_body: string };
  return { subject: saved.followup_subject ?? null, body: saved.followup_body };
}

/** The student does not want this follow-up: draft → dismissed. */
export async function dismissFollowup(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const row = await loadFollowupRow(admin, userId, applicationId);
  if (row.followup_status !== "draft") throw new FollowupError("locked");
  const { data, error } = await admin
    .from("applications")
    .update({ followup_status: "dismissed", followup_approved_at: null })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("followup_status", "draft")
    .select("id");
  if (error) throw dbError("followup dismiss", error);
  if (!Array.isArray(data) || data.length !== 1) throw new FollowupError("locked");
  await logEvent(admin, userId, "followup_dismissed");
}

// ---------------------------------------------------------------------------
// sendFollowup (explicit click of the student)

type ClaimedRow = {
  id: string;
  user_id: string;
  contact_id: string | null;
  followup_subject: string | null;
  followup_body: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
};

/** Same rule as lib/hunter/mime.ts (`<local@domain>`). */
const MESSAGE_ID_RE = /^<[^<>\s@]+@[^<>\s@]+>$/;

/**
 * Message-ID of the original application mail in the thread: the message
 * whose Gmail id is `gmail_message_id`, else the first SENT one.
 */
export function originalMessageId(
  messages: readonly ThreadMessageMeta[],
  gmailMessageId: string | null,
): string | null {
  const own = gmailMessageId ? messages.find((m) => m.id === gmailMessageId) : undefined;
  const pick = own ?? messages.find((m) => m.labelIds.includes("SENT"));
  const value = pick?.messageIdHeader?.trim() ?? "";
  return MESSAGE_ID_RE.test(value) ? value : null;
}

async function markConnectionExpired(admin: SupabaseClient, userId: string) {
  const { error } = await admin
    .from("google_connections")
    .update({ status: "expired" })
    .eq("user_id", userId);
  if (error) logFailure("google_connections expire", error);
}

/**
 * Sends the follow-up draft in the original Gmail thread. Called only from
 * the student's "Envoyer la relance" click (that click is the validation).
 * Throws FollowupError (French userMessage); the draft then holds the same
 * message in `followup_error`.
 */
export async function sendFollowup(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
  opts: { now?: () => Date; deps?: Partial<FollowupDeps> } = {},
): Promise<{ sent: true }> {
  const deps: FollowupDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? (() => new Date());
  if (!idSchema.safeParse(applicationId).success) throw new FollowupError("not_found");

  // 1. Compare-and-swap claim: draft → sending, re-checking every condition.
  const claimedAt = now().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("applications")
    .update({ followup_status: "sending", followup_approved_at: claimedAt })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("followup_status", "draft")
    .eq("status", "sent")
    .eq("followup_count", 0)
    .is("last_reply_at", null)
    .select(
      "id, user_id, contact_id, followup_subject, followup_body, gmail_thread_id, gmail_message_id",
    );
  if (claimError) throw dbError("followup claim", claimError);
  if (!Array.isArray(claimed) || claimed.length !== 1) {
    const row = await loadFollowupRow(admin, userId, applicationId);
    throw new FollowupError(row.followup_status === "sending" ? "in_progress" : "not_sendable");
  }
  const row = claimed[0] as ClaimedRow;

  const patchClaimed = async (patch: Record<string, unknown>) => {
    const { error } = await admin
      .from("applications")
      .update(patch)
      .eq("id", applicationId)
      .eq("user_id", userId)
      .eq("followup_status", "sending")
      .eq("followup_approved_at", claimedAt);
    if (error) logFailure("applications update", error);
  };
  /** Back to draft: the student must click again (never resent automatically). */
  const fail = async (code: FollowupErrorCode): Promise<never> => {
    await patchClaimed({
      followup_status: "draft",
      followup_approved_at: null,
      followup_error: FOLLOWUP_ERRORS[code],
    });
    throw new FollowupError(code);
  };

  // 2. Recipient, content, token, thread headers, MIME (no quota used yet).
  let token: { accessToken: string; email: string };
  let raw: string;
  let inReplyTo: string | null = null;
  try {
    const threadId = row.gmail_thread_id;
    if (!threadId) return await fail("not_sendable");
    const subject = (row.followup_subject ?? "").trim();
    const body = (row.followup_body ?? "").trim();
    if (!subject || !body || /[\r\n]/.test(subject)) return await fail("empty");

    if (!row.contact_id) return await fail("no_contact");
    const { data: contact, error: contactError } = await admin
      .from("contacts")
      .select("email")
      .eq("id", row.contact_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactError) throw contactError;
    const to = typeof contact?.email === "string" ? contact.email.trim() : "";
    if (!isValidEmail(to)) return await fail("no_contact");

    try {
      token = await deps.getValidAccessToken(admin, userId);
    } catch (err) {
      if (err instanceof GmailNotConnectedError) return await fail("reconnect");
      logFailure("getValidAccessToken", err);
      return await fail("google_down");
    }

    try {
      const messages = await deps.getThreadMetadata(token.accessToken, threadId);
      inReplyTo = originalMessageId(messages, row.gmail_message_id);
    } catch (err) {
      logFailure("getThreadMetadata", err);
      if (err instanceof GmailReadError && err.status === 401) {
        await markConnectionExpired(admin, userId);
        return await fail("reconnect");
      }
      // Still sent with threadId: Gmail keeps it in the thread for the sender.
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const fullName = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";

    try {
      raw = buildMimeMessage({
        from: { name: fullName, email: token.email },
        to,
        subject,
        text: body,
        html: textToHtml(body),
        ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
      });
    } catch (err) {
      if (err instanceof MimeError) return await fail("rejected");
      throw err;
    }
  } catch (err) {
    if (err instanceof FollowupError) throw err;
    logFailure("prepare send", err);
    return await fail("internal");
  }

  // 3. Quota slot (atomic, follow-ups count in the 20 / 24 h).
  let slotId: string | null;
  try {
    slotId = await deps.reserveSendSlot(admin, userId, applicationId);
  } catch (err) {
    logFailure("reserveSendSlot", err);
    return await fail("internal");
  }
  if (!slotId) return await fail("quota");

  // 4. Send in the original thread.
  let result: { id: string; threadId: string };
  try {
    result = await deps.sendRawMessage(token.accessToken, raw, {
      threadId: row.gmail_thread_id as string,
    });
  } catch (err) {
    logFailure("sendRawMessage", err);
    const status = err instanceof GmailSendError ? err.status : -1;
    // Timeout / network: it may have left. Keep the slot, never resend.
    if (status === 0) return await fail("uncertain");
    try {
      await deps.releaseSendSlot(admin, slotId);
    } catch (releaseErr) {
      logFailure("releaseSendSlot", releaseErr);
    }
    if (status === 401) {
      await markConnectionExpired(admin, userId);
      return await fail("reconnect");
    }
    if (
      status === 403 &&
      err instanceof GmailSendError &&
      /insufficient|scope/i.test(err.reason ?? "")
    ) {
      return await fail("scopes");
    }
    return await fail(
      status === 429
        ? "rate_limited"
        : status >= 500
          ? "google_down"
          : status >= 400
            ? "rejected"
            : "internal",
    );
  }

  // 5. Record. The follow-up HAS left: never back to draft from here. If the
  // record fails twice the claim stays and the cron marks it "uncertain".
  const patch = {
    followup_status: "sent",
    followup_sent_at: now().toISOString(),
    followup_count: 1,
    next_followup_at: null,
    followup_error: null,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin
      .from("applications")
      .update(patch)
      .eq("id", applicationId)
      .eq("user_id", userId);
    if (!error) break;
    logFailure("applications mark followup sent", error);
  }
  await deps.logEvent(admin, userId, "followup_sent", {
    same_thread: result.threadId === row.gmail_thread_id,
    in_reply_to: inReplyTo !== null,
  });
  return { sent: true };
}
