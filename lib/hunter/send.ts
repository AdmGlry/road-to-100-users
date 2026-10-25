/**
 * Send queue (SPEC §7.6). SERVER ONLY.
 *
 * 1. queueApprovedApplications (user client, RLS): gives a send time
 *    (`scheduled_for`, 30–90 s apart) to mails the student validated, capped
 *    to the remaining 24 h quota.
 * 2. processSendQueue (service-role client: cron route, or `after()` of the
 *    review screen filtered on the session user): sends due mails one by one.
 *
 * Safety rules, all checked server side:
 * - a mail leaves only if status = 'approved' AND approved_at is set AND
 *   scheduled_for <= now (re-checked in the claim UPDATE itself);
 * - each mail is claimed with a compare-and-swap on `send_claimed_at`, so two
 *   workers never send the same mail; a claim older than 5 minutes whose quota
 *   slot still exists is NOT retried (the mail may have left): it goes back
 *   to draft with a message asking the student to check "Messages envoyés";
 * - the quota slot is reserved atomically (reserve_send_slot) right before
 *   the Gmail call and released when the mail certainly did not leave;
 * - at most one mail per student per run, and never less than 30 s after the
 *   student's previous send (natural spacing even when the cron is late).
 * Never logs mail contents, addresses, CV or tokens: only error names/codes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import { getValidAccessToken, GmailNotConnectedError } from "@/lib/google/connection";
import {
  SEND_CLAIM_STALE_MS,
  SEND_SPACING_MIN_S,
} from "@/lib/hunter/application-types";
import { buildMimeMessage, cvFilename, isValidEmail, MimeError, textToHtml } from "@/lib/hunter/mime";
import { GmailAuthError, GmailSendError, sendRawMessage } from "@/lib/integrations/gmail";
import { CV_BUCKET } from "@/lib/profile/schema";
import {
  computeSendSchedule,
  getSendQuota,
  releaseSendSlot,
  reserveSendSlot,
} from "@/lib/quotas";

/** Follow-up reminder date after a send (SPEC §8.3). */
export const FOLLOWUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** French, user-facing `send_error` messages (shown on the review screen). */
export const SEND_ERRORS = {
  noContact:
    "Ce mail n'a pas de destinataire valide : choisis ou ajoute un contact, puis valide-le à nouveau.",
  empty: "L'objet ou le texte de ce mail est vide : complète-le, puis valide-le à nouveau.",
  noCv: "Ton CV est introuvable : ajoute-le dans ton profil, puis valide à nouveau ce mail.",
  reconnect:
    "Reconnecte ton Gmail pour envoyer ce mail : il reste validé, relance l'envoi une fois Gmail reconnecté.",
  scopes:
    "Spontané n'a pas l'autorisation d'envoyer depuis ton Gmail. Reconnecte-le en cochant toutes les cases demandées.",
  quota:
    "Limite de 20 envois sur 24 h atteinte : ce mail reste validé, relance l'envoi plus tard.",
  rejected:
    "Gmail a refusé ce mail (adresse du destinataire ou contenu invalide). Vérifie le contact, puis valide-le à nouveau.",
  rateLimited:
    "Gmail limite temporairement tes envois. Valide à nouveau ce mail dans quelques minutes.",
  googleDown: "Gmail n'a pas répondu et ce mail n'est pas parti. Valide-le à nouveau pour réessayer.",
  uncertain:
    "L'envoi a été interrompu et on ne sait pas si ce mail est parti. Regarde dans « Messages envoyés » de ton Gmail avant de le valider à nouveau.",
  internal:
    "L'envoi a échoué à cause d'une erreur de notre côté. Valide à nouveau ce mail pour réessayer.",
} as const;

export type SendDeps = {
  getValidAccessToken: (
    admin: SupabaseClient,
    userId: string,
  ) => Promise<{ accessToken: string; email: string }>;
  sendRawMessage: (accessToken: string, raw: string) => Promise<{ id: string; threadId: string }>;
  /** Downloads the CV PDF (null when missing). */
  downloadCv: (admin: SupabaseClient, path: string) => Promise<Uint8Array | null>;
  reserveSendSlot: typeof reserveSendSlot;
  releaseSendSlot: typeof releaseSendSlot;
  logEvent: typeof logEvent;
};

async function downloadCvFromStorage(
  admin: SupabaseClient,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(CV_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

const defaultDeps: SendDeps = {
  getValidAccessToken: (admin, userId) => getValidAccessToken(admin, userId),
  sendRawMessage,
  downloadCv: downloadCvFromStorage,
  reserveSendSlot,
  releaseSendSlot,
  logEvent,
};

function logFailure(step: string, err: unknown) {
  const extra: Record<string, unknown> = { name: err instanceof Error ? err.name : typeof err };
  if (err instanceof GmailSendError) {
    extra.status = err.status;
    extra.reason = err.reason;
  } else if (err && typeof err === "object" && "code" in err) {
    extra.code = String((err as { code: unknown }).code);
  }
  console.error(`[send] ${step} failed`, extra);
}

function dbError(what: string, error: { code?: string }): Error {
  return new Error(`${what} failed (${error.code ?? "unknown"})`);
}

async function latestTimestamp(
  supabase: SupabaseClient,
  table: "send_log" | "applications",
  column: "sent_at" | "scheduled_for",
  userId: string,
): Promise<Date | null> {
  let query = supabase.from(table).select(column).eq("user_id", userId);
  if (table === "applications") query = query.eq("status", "approved").not(column, "is", null);
  const { data, error } = await query.order(column, { ascending: false }).limit(1);
  if (error) throw dbError(`${table} latest`, error);
  const value = (data as Record<string, unknown>[] | null)?.[0]?.[column];
  return typeof value === "string" ? new Date(value) : null;
}

/**
 * Schedules the student's validated mails (status approved + approved_at,
 * not yet scheduled), oldest validation first, capped to the quota left.
 */
export async function queueApprovedApplications(
  supabase: SupabaseClient,
  userId: string,
  applicationIds?: string[],
  opts: { now?: Date; rand?: () => number } = {},
): Promise<{ queued: number; overQuota: number }> {
  const now = opts.now ?? new Date();
  let query = supabase
    .from("applications")
    .select("id, approved_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("approved_at", "is", null)
    .is("scheduled_for", null);
  if (applicationIds) {
    if (applicationIds.length === 0) return { queued: 0, overQuota: 0 };
    query = query.in("id", applicationIds);
  }
  const { data, error } = await query.order("approved_at", { ascending: true });
  if (error) throw dbError("applications select", error);
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return { queued: 0, overQuota: 0 };

  const quota = await getSendQuota(supabase, userId, now);
  const toQueue = rows.slice(0, quota.remaining);
  if (toQueue.length === 0) return { queued: 0, overQuota: rows.length };

  const [lastQueued, lastSent] = await Promise.all([
    latestTimestamp(supabase, "applications", "scheduled_for", userId),
    latestTimestamp(supabase, "send_log", "sent_at", userId),
  ]);
  const last =
    lastQueued && lastSent
      ? new Date(Math.max(lastQueued.getTime(), lastSent.getTime()))
      : (lastQueued ?? lastSent);
  const schedule = computeSendSchedule(toQueue.length, now, last, opts.rand);

  let queued = 0;
  for (let i = 0; i < toQueue.length; i++) {
    const { data: updated, error: updateError } = await supabase
      .from("applications")
      .update({ scheduled_for: schedule[i].toISOString(), send_error: null })
      .eq("id", toQueue[i].id)
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("scheduled_for", null)
      .select("id");
    if (updateError) throw dbError("applications schedule", updateError);
    if (Array.isArray(updated) && updated.length > 0) queued++;
  }
  return { queued, overQuota: rows.length - toQueue.length };
}

type QueueRow = {
  id: string;
  user_id: string;
  lead_id: string;
  contact_id: string | null;
  subject: string | null;
  body: string | null;
  scheduled_for: string;
  send_claimed_at: string | null;
};

export type ProcessSendQueueOptions = {
  /** Only this student's mails (review screen). Omitted = every student (cron). */
  userId?: string;
  /** Stop after this many sends. */
  maxSends?: number;
  /** Do not start a new send after this many ms. */
  deadlineMs?: number;
  now?: () => Date;
  deps?: Partial<SendDeps>;
};

/** Sends the due mails. Throws only if the queue itself cannot be read. */
export async function processSendQueue(
  admin: SupabaseClient,
  opts: ProcessSendQueueOptions = {},
): Promise<{ sent: number; failed: number; deferred: number }> {
  const deps: SendDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? (() => new Date());
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? 50_000;
  const maxSends = opts.maxSends ?? Infinity;
  const counts = { sent: 0, failed: 0, deferred: 0 };

  let query = admin
    .from("applications")
    .select("id, user_id, lead_id, contact_id, subject, body, scheduled_for, send_claimed_at")
    .eq("status", "approved")
    .not("approved_at", "is", null)
    .lte("scheduled_for", now().toISOString());
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data, error } = await query.order("scheduled_for", { ascending: true }).limit(200);
  if (error) throw dbError("send queue select", error);
  const rows = (data ?? []) as QueueRow[];

  /** Students already served (or stopped) in this run. */
  const doneUsers = new Set<string>();
  const tokens = new Map<string, { accessToken: string; email: string }>();

  // --- row updates (always filtered on id + user_id) -------------------------
  const updateRow = async (row: QueueRow, patch: Record<string, unknown>) => {
    const { error: e } = await admin
      .from("applications")
      .update(patch)
      .eq("id", row.id)
      .eq("user_id", row.user_id);
    if (e) logFailure("applications update", e);
  };
  /** Back to draft: the student must validate again (SPEC §7.6). */
  const toDraft = (row: QueueRow, message: string) =>
    updateRow(row, {
      status: "draft",
      approved_at: null,
      scheduled_for: null,
      send_claimed_at: null,
      send_error: message,
    });
  /** Out of the queue but still validated (quota, Gmail to reconnect). */
  const unscheduleUser = async (row: QueueRow, message: string) => {
    await updateRow(row, { scheduled_for: null, send_claimed_at: null, send_error: message });
    const { error: e } = await admin
      .from("applications")
      .update({ scheduled_for: null, send_error: message })
      .eq("user_id", row.user_id)
      .eq("status", "approved")
      .not("scheduled_for", "is", null)
      .is("send_claimed_at", null);
    if (e) logFailure("applications unschedule", e);
  };
  const releaseClaim = (row: QueueRow) => updateRow(row, { send_claimed_at: null });
  const release = async (slotId: string) => {
    try {
      await deps.releaseSendSlot(admin, slotId);
    } catch (err) {
      logFailure("releaseSendSlot", err);
    }
  };

  for (const row of rows) {
    if (Date.now() - startedAt > deadlineMs || counts.sent >= maxSends) break;
    if (doneUsers.has(row.user_id)) {
      counts.deferred++;
      continue;
    }
    const nowDate = now();
    const nowIso = nowDate.toISOString();

    // Claimed by a live worker: leave it alone.
    const staleClaim =
      row.send_claimed_at !== null &&
      nowDate.getTime() - Date.parse(row.send_claimed_at) >= SEND_CLAIM_STALE_MS;
    if (row.send_claimed_at !== null && !staleClaim) {
      counts.deferred++;
      continue;
    }

    try {
      // Natural spacing: never two sends of the same student < 30 s apart.
      const lastSent = await latestTimestamp(admin, "send_log", "sent_at", row.user_id);
      if (lastSent && nowDate.getTime() - lastSent.getTime() < SEND_SPACING_MIN_S * 1000) {
        doneUsers.add(row.user_id);
        counts.deferred++;
        continue;
      }

      // Compare-and-swap claim; re-checks every send condition in the UPDATE.
      let claim = admin
        .from("applications")
        .update({ send_claimed_at: nowIso })
        .eq("id", row.id)
        .eq("user_id", row.user_id)
        .eq("status", "approved")
        .not("approved_at", "is", null)
        .lte("scheduled_for", nowIso);
      claim = row.send_claimed_at
        ? claim.eq("send_claimed_at", row.send_claimed_at)
        : claim.is("send_claimed_at", null);
      const { data: claimed, error: claimError } = await claim.select("id");
      if (claimError) throw dbError("claim", claimError);
      if (!Array.isArray(claimed) || claimed.length !== 1) {
        counts.deferred++;
        continue;
      }

      if (staleClaim) {
        // A previous worker died mid-send. If it had reserved a slot, the
        // mail may have left: never resend automatically.
        const { data: slots, error: slotError } = await admin
          .from("send_log")
          .select("id")
          .eq("user_id", row.user_id)
          .eq("application_id", row.id)
          .limit(1);
        if (slotError) throw dbError("send_log select", slotError);
        if (Array.isArray(slots) && slots.length > 0) {
          await toDraft(row, SEND_ERRORS.uncertain);
          counts.failed++;
          continue;
        }
      }

      const outcome = await sendOne(admin, row, deps, tokens, nowDate, {
        toDraft,
        unscheduleUser,
        releaseClaim,
        release,
      });
      counts[outcome]++;
      doneUsers.add(row.user_id);
    } catch (err) {
      // Unexpected error before any slot was reserved: free the mail.
      logFailure("processSendQueue row", err);
      await releaseClaim(row);
      counts.deferred++;
      doneUsers.add(row.user_id);
    }
  }
  return counts;
}

type RowActions = {
  toDraft: (row: QueueRow, message: string) => Promise<void>;
  unscheduleUser: (row: QueueRow, message: string) => Promise<void>;
  releaseClaim: (row: QueueRow) => Promise<void>;
  release: (slotId: string) => Promise<void>;
};

/** Sends one claimed mail. Returns which counter to increment. */
async function sendOne(
  admin: SupabaseClient,
  row: QueueRow,
  deps: SendDeps,
  tokens: Map<string, { accessToken: string; email: string }>,
  nowDate: Date,
  actions: RowActions,
): Promise<"sent" | "failed" | "deferred"> {
  const { toDraft, unscheduleUser, releaseClaim, release } = actions;
  const userId = row.user_id;

  // 1. Recipient, content, CV (no quota consumed yet).
  if (!row.contact_id) {
    await toDraft(row, SEND_ERRORS.noContact);
    return "failed";
  }
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("email")
    .eq("id", row.contact_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (contactError) throw dbError("contacts select", contactError);
  const to = typeof contact?.email === "string" ? contact.email.trim() : "";
  if (!isValidEmail(to)) {
    await toDraft(row, SEND_ERRORS.noContact);
    return "failed";
  }
  const subject = (row.subject ?? "").trim();
  const body = (row.body ?? "").trim();
  if (!subject || !body) {
    await toDraft(row, SEND_ERRORS.empty);
    return "failed";
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name, cv_storage_path")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw dbError("profiles select", profileError);
  const cvPath = typeof profile?.cv_storage_path === "string" ? profile.cv_storage_path : "";
  // The CV must live in the student's own folder (defense in depth).
  const cv = cvPath.startsWith(`${userId}/`) ? await deps.downloadCv(admin, cvPath) : null;
  if (!cv || cv.length === 0) {
    await toDraft(row, SEND_ERRORS.noCv);
    return "failed";
  }
  const fullName = typeof profile?.full_name === "string" ? profile.full_name : null;

  // 2. Gmail access token (cached per student for this run).
  let token = tokens.get(userId);
  if (!token) {
    try {
      token = await deps.getValidAccessToken(admin, userId);
      tokens.set(userId, token);
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        await unscheduleUser(row, SEND_ERRORS.reconnect);
        return "deferred";
      }
      // Transient Google failure: retry on a later run.
      logFailure("getValidAccessToken", err);
      await releaseClaim(row);
      return "deferred";
    }
  }

  // 3. MIME.
  let raw: string;
  try {
    raw = buildMimeMessage({
      from: { name: fullName?.trim() ?? "", email: token.email },
      to,
      subject,
      text: body,
      html: textToHtml(body),
      attachment: { filename: cvFilename(fullName), content: cv, mimeType: "application/pdf" },
    });
  } catch (err) {
    if (err instanceof MimeError) {
      await toDraft(row, SEND_ERRORS.rejected);
      return "failed";
    }
    throw err;
  }

  // 4. Quota slot (atomic).
  const slotId = await deps.reserveSendSlot(admin, userId, row.id);
  if (!slotId) {
    await unscheduleUser(row, SEND_ERRORS.quota);
    return "deferred";
  }

  // 5. Send.
  let result: { id: string; threadId: string };
  try {
    result = await deps.sendRawMessage(token.accessToken, raw);
  } catch (err) {
    logFailure("sendRawMessage", err);
    const status = err instanceof GmailSendError ? err.status : -1;
    if (status === 0) {
      // Timeout / network: the mail may have left. Keep the slot, ask to check.
      await toDraft(row, SEND_ERRORS.uncertain);
      return "failed";
    }
    await release(slotId);
    if (status === 401) {
      await markConnectionExpired(admin, userId);
      await unscheduleUser(row, SEND_ERRORS.reconnect);
      return "deferred";
    }
    if (status === 403 && err instanceof GmailSendError && /insufficient|scope/i.test(err.reason ?? "")) {
      await unscheduleUser(row, SEND_ERRORS.scopes);
      return "deferred";
    }
    const message =
      status === 429
        ? SEND_ERRORS.rateLimited
        : status >= 500
          ? SEND_ERRORS.googleDown
          : status >= 400
            ? SEND_ERRORS.rejected
            : SEND_ERRORS.internal;
    await toDraft(row, message);
    return "failed";
  }

  // 6. Record the send. The mail HAS left: never revert to draft from here.
  const sentAt = nowDate.toISOString();
  const patch = {
    status: "sent",
    sent_at: sentAt,
    gmail_message_id: result.id,
    gmail_thread_id: result.threadId,
    next_followup_at: new Date(nowDate.getTime() + FOLLOWUP_AFTER_MS).toISOString(),
    send_error: null,
    send_claimed_at: null,
    scheduled_for: null,
  };
  let recorded = false;
  for (let attempt = 0; attempt < 2 && !recorded; attempt++) {
    const { error: e } = await admin
      .from("applications")
      .update(patch)
      .eq("id", row.id)
      .eq("user_id", userId);
    if (e) logFailure("applications mark sent", e);
    else recorded = true;
  }
  // If both attempts failed the claim stays: the stale-claim check will mark
  // the mail "uncertain" instead of sending it twice.

  const { error: leadError } = await admin
    .from("leads")
    .update({ status: "sent" })
    .eq("id", row.lead_id)
    .eq("user_id", userId);
  if (leadError) logFailure("leads update", leadError);

  await deps.logEvent(admin, userId, "mail_sent", { with_cv: true });
  return "sent";
}

async function markConnectionExpired(admin: SupabaseClient, userId: string) {
  const { error } = await admin
    .from("google_connections")
    .update({ status: "expired" })
    .eq("user_id", userId);
  if (error) logFailure("google_connections expire", error);
}

// Re-exported for callers that only import the send module.
export { GmailAuthError, GmailNotConnectedError };
