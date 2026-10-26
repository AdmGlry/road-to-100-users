/**
 * Reply sync (SPEC §8.1). SERVER ONLY (service-role client).
 *
 * For each student whose Gmail connection is active and who has applications
 * sent in the last SYNC_WINDOW_DAYS days:
 * 1. reads ONLY the app's own threads (`applications.gmail_thread_id`,
 *    SPEC §6.2), format metadata first;
 * 2. a message is a new reply when it is not the original send, not sent by
 *    the student (label SENT or From = the connected address — follow-ups
 *    included), not a draft, and not already in `replies`;
 * 3. its text (format full, that message only) is cleaned and classified,
 *    then stored with a 200-char snippet (unique gmail_message_id: a second
 *    run inserts nothing);
 * 4. the application is updated: last_reply_at, status (unless the student
 *    moved the card), pending follow-up draft dismissed on a real reply,
 *    interview notification (once).
 * One student's failure never stops the others; the run stops starting new
 * work after `deadlineMs` and the next run resumes (idempotent).
 * Never logs reply contents, addresses or tokens: only counts and error names.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import { getValidAccessToken, GmailNotConnectedError } from "@/lib/google/connection";
import {
  getMessageText,
  getThreadMetadata,
  GmailReadError,
  type ThreadMessageMeta,
} from "@/lib/integrations/gmail";
import type { LlmUsageEvent } from "@/lib/llm/client";
import {
  classifyReply,
  cleanReplyText,
  extractEmailAddress,
  statusForClassification,
  type ClassifyDeps,
  type ReplyInput,
} from "@/lib/tracker/classify";
import { notifyInterview, type NotifyInterviewInput } from "@/lib/tracker/notify";
import {
  SENT_STATUSES,
  SNIPPET_MAX_CHARS,
  SYNC_WINDOW_DAYS,
  type ClassifiedReply,
  type FollowupStatus,
  type SentStatus,
} from "@/lib/tracker/types";

export type SyncDeps = {
  getValidAccessToken: (
    admin: SupabaseClient,
    userId: string,
  ) => Promise<{ accessToken: string; email: string }>;
  getThreadMetadata: (accessToken: string, threadId: string) => Promise<ThreadMessageMeta[]>;
  getMessageText: (accessToken: string, messageId: string) => Promise<string>;
  classifyReply: (input: ReplyInput, deps: ClassifyDeps) => Promise<ClassifiedReply>;
  notifyInterview: (admin: SupabaseClient, input: NotifyInterviewInput) => Promise<unknown>;
  logEvent: typeof logEvent;
};

const defaultDeps: SyncDeps = {
  getValidAccessToken: (admin, userId) => getValidAccessToken(admin, userId),
  getThreadMetadata,
  getMessageText,
  classifyReply,
  notifyInterview: (admin, input) => notifyInterview(admin, input),
  logEvent,
};

export type SyncRepliesOptions = {
  /** Only this student (manual "Synchroniser maintenant"). Omitted = every student (cron). */
  userId?: string;
  /** Do not start new work after this many ms (default 50 000). */
  deadlineMs?: number;
  now?: () => Date;
  deps?: Partial<SyncDeps>;
};

export type SyncRepliesResult = {
  users: number;
  threads: number;
  newReplies: number;
  errors: number;
};

type ConnectionRow = { user_id: string; sync_attempted_at: string | null };

type AppRow = {
  id: string;
  user_id: string;
  lead_id: string | null;
  status: SentStatus;
  gmail_thread_id: string;
  gmail_message_id: string | null;
  sent_at: string | null;
  last_reply_at: string | null;
  status_set_manually: boolean | null;
  followup_status: FollowupStatus | null;
  interview_notified_at: string | null;
  replies_checked_at?: string | null;
};

const APP_COLUMNS =
  "id, user_id, lead_id, status, gmail_thread_id, gmail_message_id, sent_at, last_reply_at, status_set_manually, followup_status, interview_notified_at, replies_checked_at";

function dbError(what: string, error: { code?: string }): Error {
  return new Error(`${what} failed (${error.code ?? "unknown"})`);
}

function logFailure(step: string, err: unknown) {
  const extra: Record<string, unknown> = { name: err instanceof Error ? err.name : typeof err };
  if (err instanceof GmailReadError) {
    extra.status = err.status;
    extra.reason = err.reason;
  } else if (err && typeof err === "object" && "code" in err) {
    extra.code = String((err as { code: unknown }).code);
  }
  console.error(`[sync] ${step} failed`, extra);
}

/** Stops the current student (Gmail access revoked during the run). */
class StopUser extends Error {
  constructor() {
    super("stop user");
    this.name = "StopUser";
  }
}

/** One-line snippet of the cleaned text, SNIPPET_MAX_CHARS max. */
export function toSnippet(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > SNIPPET_MAX_CHARS
    ? `${flat.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`
    : flat;
}

/** Messages of a thread that are replies received by the student (not yet filtered on `replies`). */
export function receivedMessages(
  messages: readonly ThreadMessageMeta[],
  app: Pick<AppRow, "gmail_message_id">,
  studentEmail: string,
): ThreadMessageMeta[] {
  const own = studentEmail.trim().toLowerCase();
  return messages.filter((m) => {
    if (m.id === app.gmail_message_id) return false;
    if (m.labelIds.includes("SENT") || m.labelIds.includes("DRAFT")) return false;
    const from = extractEmailAddress(m.from);
    return !(own && from === own);
  });
}

async function markConnectionExpired(admin: SupabaseClient, userId: string) {
  const { error } = await admin
    .from("google_connections")
    .update({ status: "expired" })
    .eq("user_id", userId);
  if (error) logFailure("google_connections expire", error);
}

async function companyNameFor(admin: SupabaseClient, app: AppRow): Promise<string | null> {
  if (!app.lead_id) return null;
  const { data, error } = await admin
    .from("leads")
    .select("id, company:companies(name)")
    .eq("id", app.lead_id)
    .eq("user_id", app.user_id)
    .maybeSingle();
  if (error) {
    logFailure("leads select", error);
    return null;
  }
  const company = (data as { company?: { name?: unknown } | null } | null)?.company;
  return typeof company?.name === "string" ? company.name : null;
}

/** Syncs the replies of the app's threads. Throws only if the connections cannot be read. */
export async function syncReplies(
  admin: SupabaseClient,
  opts: SyncRepliesOptions = {},
): Promise<SyncRepliesResult> {
  const deps: SyncDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? (() => new Date());
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? 50_000;
  const pastDeadline = () => Date.now() - startedAt > deadlineMs;
  const result: SyncRepliesResult = { users: 0, threads: 0, newReplies: 0, errors: 0 };

  let connQuery = admin
    .from("google_connections")
    .select("user_id, sync_attempted_at")
    .eq("status", "active");
  if (opts.userId) connQuery = connQuery.eq("user_id", opts.userId);
  const { data: connData, error: connError } = await connQuery;
  if (connError) throw dbError("google_connections select", connError);
  // Least recently attempted first (complete or not), so a run cut by the
  // deadline or a failing account never starves anyone.
  const connections = ((connData ?? []) as ConnectionRow[]).sort((a, b) =>
    (a.sync_attempted_at ?? "").localeCompare(b.sync_attempted_at ?? ""),
  );

  for (const conn of connections) {
    if (pastDeadline()) break;
    try {
      const outcome = await syncUser(admin, conn.user_id, deps, now, pastDeadline, result);
      const at = now().toISOString();
      const { error } = await admin
        .from("google_connections")
        .update(
          outcome === "done"
            ? { last_sync_at: at, sync_attempted_at: at }
            : { sync_attempted_at: at },
        )
        .eq("user_id", conn.user_id);
      if (error) logFailure("sync timestamps update", error);
    } catch (err) {
      logFailure("syncUser", err);
      result.errors++;
    }
  }
  return result;
}

/**
 * Syncs one student. "done" = every thread was read (last_sync_at may move),
 * "partial" = stopped by an error or the deadline, "skipped" = nothing to do.
 */
async function syncUser(
  admin: SupabaseClient,
  userId: string,
  deps: SyncDeps,
  now: () => Date,
  pastDeadline: () => boolean,
  result: SyncRepliesResult,
): Promise<"done" | "partial" | "skipped"> {
  const since = new Date(now().getTime() - SYNC_WINDOW_DAYS * 24 * 3600_000).toISOString();
  const { data: appData, error: appError } = await admin
    .from("applications")
    .select(APP_COLUMNS)
    .eq("user_id", userId)
    .not("gmail_thread_id", "is", null)
    .gte("sent_at", since)
    .in("status", [...SENT_STATUSES]);
  if (appError) throw dbError("applications select", appError);
  // Least recently checked threads first: a long list is covered over several runs.
  const apps = ((appData ?? []) as AppRow[]).sort((a, b) =>
    (a.replies_checked_at ?? "").localeCompare(b.replies_checked_at ?? ""),
  );
  if (apps.length === 0) return "skipped";

  let token: { accessToken: string; email: string };
  try {
    token = await deps.getValidAccessToken(admin, userId);
  } catch (err) {
    // Not connected any more: the connection is already marked expired.
    if (err instanceof GmailNotConnectedError) return "skipped";
    throw err;
  }
  result.users++;

  const { data: known, error: knownError } = await admin
    .from("replies")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in(
      "application_id",
      apps.map((a) => a.id),
    );
  if (knownError) throw dbError("replies select", knownError);
  const knownIds = new Set(
    ((known ?? []) as { gmail_message_id: string }[]).map((r) => r.gmail_message_id),
  );

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

  let complete = true;
  for (const app of apps) {
    if (pastDeadline()) return "partial";
    try {
      const ok = await syncThread(admin, app, token, knownIds, deps, onUsage, pastDeadline, result);
      if (!ok) complete = false;
      else {
        const { error } = await admin
          .from("applications")
          .update({ replies_checked_at: now().toISOString() })
          .eq("id", app.id)
          .eq("user_id", userId);
        if (error) logFailure("replies_checked_at update", error);
      }
    } catch (err) {
      if (err instanceof StopUser) {
        result.errors++;
        return "partial";
      }
      logFailure("syncThread", err);
      result.errors++;
      complete = false;
    }
  }
  return complete ? "done" : "partial";
}

/** Throws StopUser on a 401 (connection marked expired). Returns false when something was left for later. */
async function syncThread(
  admin: SupabaseClient,
  app: AppRow,
  token: { accessToken: string; email: string },
  knownIds: Set<string>,
  deps: SyncDeps,
  onUsage: (usage: LlmUsageEvent) => Promise<void>,
  pastDeadline: () => boolean,
  result: SyncRepliesResult,
): Promise<boolean> {
  const userId = app.user_id;
  /** 401 = access revoked during the run: mark expired and stop this student. */
  const stopOn401 = async (err: unknown) => {
    if (err instanceof GmailReadError && err.status === 401) {
      await markConnectionExpired(admin, userId);
      throw new StopUser();
    }
  };

  let messages: ThreadMessageMeta[];
  try {
    messages = await deps.getThreadMetadata(token.accessToken, app.gmail_thread_id);
  } catch (err) {
    // Thread deleted by the student: nothing to read.
    if (err instanceof GmailReadError && err.status === 404) return true;
    await stopOn401(err);
    throw err;
  }
  result.threads++;

  const fresh = receivedMessages(messages, app, token.email).filter((m) => !knownIds.has(m.id));
  let complete = true;
  for (const message of fresh) {
    if (pastDeadline()) return false;

    let rawText: string;
    try {
      rawText = await deps.getMessageText(token.accessToken, message.id);
    } catch (err) {
      if (err instanceof GmailReadError && err.status === 404) continue;
      await stopOn401(err);
      logFailure("getMessageText", err);
      result.errors++;
      complete = false;
      continue;
    }
    const text = cleanReplyText(rawText);
    const classified = await deps.classifyReply(
      { from: message.from, subject: message.subject, autoHeaders: message.autoHeaders, text },
      { onUsage },
    );

    const receivedAt = new Date(message.internalDate || Date.now()).toISOString();
    const fromEmail = extractEmailAddress(message.from);
    const { error: insertError } = await admin.from("replies").insert({
      user_id: userId,
      application_id: app.id,
      gmail_message_id: message.id,
      received_at: receivedAt,
      from_email: fromEmail || null,
      snippet: toSnippet(text),
      classification: classified.classification,
      classification_confidence: classified.confidence,
      suggested_action: classified.suggested_action,
    });
    if (insertError) {
      // 23505 = unique gmail_message_id: another run stored it first.
      if (insertError.code !== "23505") {
        logFailure("replies insert", insertError);
        result.errors++;
        complete = false;
      }
      knownIds.add(message.id);
      continue;
    }
    knownIds.add(message.id);
    result.newReplies++;
    await deps.logEvent(admin, userId, "reply_received", {
      classification: classified.classification,
      source: classified.source,
    });

    await applyReply(admin, app, classified.classification, receivedAt, deps);
  }
  return complete;
}

/** Updates the application after a stored reply (mutates `app` to keep later replies consistent). */
async function applyReply(
  admin: SupabaseClient,
  app: AppRow,
  classification: ClassifiedReply["classification"],
  receivedAt: string,
  deps: SyncDeps,
): Promise<void> {
  const userId = app.user_id;
  const patch: Record<string, unknown> = {};
  // A bounce is not an answer from a person: it must not block the follow-up
  // and no_reply rules of the mail re-sent to another contact.
  const realReply = classification !== "auto_reply" && classification !== "bounce";
  if (realReply && (!app.last_reply_at || receivedAt > app.last_reply_at)) {
    patch.last_reply_at = receivedAt;
  }
  if (!app.status_set_manually) {
    const next = statusForClassification(app.status, classification);
    if (next) patch.status = next;
  }
  if (Object.keys(patch).length > 0) {
    let update = admin.from("applications").update(patch).eq("id", app.id).eq("user_id", userId);
    // Never overwrite a card the student moved while this run was going.
    if (patch.status) update = update.eq("status", app.status).eq("status_set_manually", false);
    const { error } = await update;
    if (error) logFailure("applications update", error);
    else Object.assign(app, patch);
  }

  // A real reply or a bounce makes a pending follow-up draft pointless (never touch sending/sent).
  if ((realReply || classification === "bounce") && app.followup_status === "draft") {
    const { error } = await admin
      .from("applications")
      .update({ followup_status: "dismissed" })
      .eq("id", app.id)
      .eq("user_id", userId)
      .eq("followup_status", "draft");
    if (error) logFailure("followup dismiss", error);
    else app.followup_status = "dismissed";
  }

  if (classification === "interview" && !app.interview_notified_at) {
    try {
      await deps.notifyInterview(admin, {
        userId,
        applicationId: app.id,
        companyName: await companyNameFor(admin, app),
      });
      app.interview_notified_at = new Date().toISOString();
    } catch (err) {
      logFailure("notifyInterview", err);
    }
  }
}
