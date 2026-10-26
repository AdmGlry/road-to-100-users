/**
 * Tracker board read model and manual corrections (SPEC §8.4). SERVER ONLY.
 *
 * - loadTrackerState() reads with the signed-in user's client (RLS) and the
 *   user id verified from the session.
 * - moveCard() / reviseBounced() run on the SERVICE-ROLE client (sent
 *   applications are read-only for clients, see the
 *   `applications_guard_client_write` trigger). Every query is filtered on
 *   the session user id and the expected current status, so a student can
 *   only change their own sent applications, and only through the allowed
 *   transitions.
 *
 * Mail contents, reply snippets and e-mail addresses are never logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import { getGmailStatus } from "@/lib/google/connection";
import {
  SENT_STATUSES,
  TRACKER_COLUMNS,
  type FollowupStatus,
  type ReplyClassification,
  type SentStatus,
  type TrackerCard,
  type TrackerColumn,
  type TrackerReply,
  type TrackerState,
  type TrackerStats,
} from "@/lib/tracker/types";

/** Max applications shown on the board (newest sent first). */
export const BOARD_LIMIT = 300;
/** Ids per `in (...)` filter: keeps the PostgREST URL short. */
const IN_CHUNK = 100;

export const BOUNCED_REVISE_ERROR =
  "L'adresse précédente n'existait pas : choisis un autre contact puis valide à nouveau ce mail.";

export type TrackerErrorCode = "not_found" | "not_allowed" | "db";

const TRACKER_MESSAGES: Record<TrackerErrorCode, string> = {
  not_found: "Cette candidature est introuvable. Recharge la page.",
  not_allowed: "Cette candidature ne peut pas être déplacée ainsi. Recharge la page.",
  db: "Ton changement n'a pas été enregistré. Vérifie ta connexion puis réessaie.",
};

export class TrackerError extends Error {
  readonly userMessage: string;
  constructor(
    readonly code: TrackerErrorCode,
    options?: { cause?: unknown; message?: string },
  ) {
    super(`tracker: ${code}`, options?.cause ? { cause: options.cause } : undefined);
    this.name = "TrackerError";
    this.userMessage = options?.message ?? TRACKER_MESSAGES[code];
  }
}

function dbError(what: string, error: { code?: string } | null): TrackerError {
  return new TrackerError("db", {
    cause: new Error(`${what} failed (${error?.code ?? "unknown"})`),
  });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const COLUMN_IDS = new Set<string>(TRACKER_COLUMNS.map((c) => c.id));
const SENT_STATUS_SET = new Set<string>(SENT_STATUSES);

export function isTrackerColumn(value: unknown): value is TrackerColumn {
  return typeof value === "string" && COLUMN_IDS.has(value);
}

export function isSentStatus(value: unknown): value is SentStatus {
  return typeof value === "string" && SENT_STATUS_SET.has(value);
}

/** Kanban column of a sent application: bounced mails stay in "Envoyé" (with an alert). */
export function columnForStatus(status: SentStatus): TrackerColumn {
  return status === "bounced" ? "sent" : status;
}

/** Status given to a card the student moves to `column`. */
export function statusForColumn(column: TrackerColumn): SentStatus {
  return column;
}

/** Link to the thread in the student's Gmail (all mail). */
export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

const AUTOMATIC: ReadonlySet<ReplyClassification | null> = new Set(["auto_reply", "bounce"]);

/** A reply written by a person (not an absence notice nor a delivery failure). */
export function isHumanReply(reply: Pick<TrackerReply, "classification">): boolean {
  return !AUTOMATIC.has(reply.classification);
}

export function computeStats(cards: readonly TrackerCard[]): TrackerStats {
  const sent = cards.length;
  const replied = cards.filter((c) => c.replies.some(isHumanReply)).length;
  return {
    sent,
    replied,
    replyRate: sent > 0 ? replied / sent : 0,
    interviews: cards.filter((c) => c.status === "interview").length,
    pendingFollowups: cards.filter((c) => c.followup?.status === "draft").length,
  };
}

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const APPLICATION_COLUMNS =
  "id, lead_id, contact_id, subject, body, status, sent_at, last_reply_at, gmail_thread_id, " +
  "followup_status, followup_subject, followup_body, followup_approved_at, followup_sent_at, " +
  "followup_error, status_set_manually";

type ApplicationRow = {
  id: string;
  lead_id: string;
  contact_id: string | null;
  subject: string | null;
  body: string | null;
  status: SentStatus;
  sent_at: string | null;
  last_reply_at: string | null;
  gmail_thread_id: string | null;
  followup_status: FollowupStatus | null;
  followup_subject: string | null;
  followup_body: string | null;
  followup_approved_at: string | null;
  followup_sent_at: string | null;
  followup_error: string | null;
  status_set_manually: boolean | null;
};

type LeadRow = {
  id: string;
  establishment_city?: string | null;
  company: { name: string; city: string | null } | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
};

type ReplyRow = TrackerReply & { application_id: string };

async function selectChunked<T>(
  ids: readonly string[],
  what: string,
  query: (chunk: string[]) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
): Promise<T[]> {
  const results = await Promise.all(chunks(ids).map((c) => query(c)));
  const rows: T[] = [];
  for (const res of results) {
    if (res.error) throw dbError(what, res.error);
    rows.push(...((res.data ?? []) as T[]));
  }
  return rows;
}

/** `last_sync_at` of the student's Gmail connection (token-free RPC). Never throws. */
async function readLastSyncAt(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("google_connection_status");
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as
      { last_sync_at?: string | null } | null | undefined;
    return row?.last_sync_at ?? null;
  } catch {
    return null;
  }
}

function contactName(c: ContactRow): string | null {
  const name = [c.first_name, c.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}

/**
 * Board of the signed-in user: sent applications (newest first, at most
 * BOARD_LIMIT) with company, recipient, replies (snippets only) and
 * follow-up, the statistics, the Gmail status and the last sync time.
 */
export async function loadTrackerState(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrackerState> {
  const [appsRes, gmail, lastSyncAt] = await Promise.all([
    supabase
      .from("applications")
      .select(APPLICATION_COLUMNS)
      .eq("user_id", userId)
      .in("status", [...SENT_STATUSES])
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(BOARD_LIMIT),
    getGmailStatus(supabase),
    readLastSyncAt(supabase),
  ]);
  if (appsRes.error) throw dbError("applications select", appsRes.error);
  const apps = (appsRes.data ?? []) as unknown as ApplicationRow[];

  const leadIds = [...new Set(apps.map((a) => a.lead_id))];
  const contactIds = [...new Set(apps.flatMap((a) => (a.contact_id ? [a.contact_id] : [])))];
  const appIds = apps.map((a) => a.id);

  const [leads, contacts, replies] = await Promise.all([
    selectChunked<LeadRow>(leadIds, "leads select", (ids) =>
      supabase
        .from("leads")
        .select("id, establishment_city, company:companies(name, city)")
        .eq("user_id", userId)
        .in("id", ids),
    ),
    selectChunked<ContactRow>(contactIds, "contacts select", (ids) =>
      supabase
        .from("contacts")
        .select("id, first_name, last_name, email")
        .eq("user_id", userId)
        .in("id", ids),
    ),
    selectChunked<ReplyRow>(appIds, "replies select", (ids) =>
      supabase
        .from("replies")
        .select(
          "id, application_id, received_at, from_email, snippet, classification, suggested_action",
        )
        .eq("user_id", userId)
        .in("application_id", ids)
        .order("received_at", { ascending: false })
        .limit(1000),
    ),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const repliesByApp = new Map<string, TrackerReply[]>();
  for (const r of replies) {
    const list = repliesByApp.get(r.application_id) ?? [];
    list.push({
      id: r.id,
      received_at: r.received_at,
      from_email: r.from_email ?? null,
      snippet: r.snippet ?? null,
      classification: r.classification ?? null,
      suggested_action: r.suggested_action ?? null,
    });
    repliesByApp.set(r.application_id, list);
  }

  const cards: TrackerCard[] = apps.flatMap((a) => {
    if (!isSentStatus(a.status)) return [];
    const lead = leadById.get(a.lead_id);
    const contact = a.contact_id ? contactById.get(a.contact_id) : undefined;
    const appReplies = (repliesByApp.get(a.id) ?? []).sort((x, y) =>
      String(y.received_at).localeCompare(String(x.received_at)),
    );
    const card: TrackerCard = {
      applicationId: a.id,
      company: {
        name: lead?.company?.name ?? "Entreprise",
        city: lead?.establishment_city ?? lead?.company?.city ?? null,
      },
      contact: contact ? { name: contactName(contact), email: contact.email } : null,
      subject: a.subject ?? "",
      body: a.body ?? "",
      status: a.status,
      column: columnForStatus(a.status),
      sent_at: a.sent_at,
      last_reply_at: a.last_reply_at ?? appReplies[0]?.received_at ?? null,
      gmailUrl: a.gmail_thread_id ? gmailThreadUrl(a.gmail_thread_id) : null,
      replies: appReplies,
      followup: a.followup_status
        ? {
            status: a.followup_status,
            subject: a.followup_subject ?? "",
            body: a.followup_body ?? "",
            approved_at: a.followup_approved_at,
            sent_at: a.followup_sent_at,
            error: a.followup_error,
          }
        : null,
      status_set_manually: Boolean(a.status_set_manually),
    };
    return [card];
  });

  return { cards, stats: computeStats(cards), gmail, lastSyncAt };
}

// ---------------------------------------------------------------------------
// Mutations (service-role client, filtered on the session user id)
// ---------------------------------------------------------------------------

async function loadOwned(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<{ id: string; lead_id: string; contact_id: string | null; status: string }> {
  const { data, error } = await admin
    .from("applications")
    .select("id, lead_id, contact_id, status")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("applications select (owned)", error);
  if (!data) throw new TrackerError("not_found");
  return data as { id: string; lead_id: string; contact_id: string | null; status: string };
}

/**
 * Manual correction from the board ("Déplacer vers"). Only between sent
 * statuses (a bounced card may move too). The sync never moves the card
 * back afterwards (`status_set_manually`).
 */
export async function moveCard(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
  column: TrackerColumn,
): Promise<{ changed: boolean; status: SentStatus }> {
  if (!isTrackerColumn(column)) throw new TrackerError("not_allowed");
  const row = await loadOwned(admin, userId, applicationId);
  if (!isSentStatus(row.status)) throw new TrackerError("not_allowed");
  const from = row.status;
  const to = statusForColumn(column);
  if (from === to) return { changed: false, status: from };

  const { data, error } = await admin
    .from("applications")
    .update({ status: to, status_set_manually: true })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("status", from)
    .select("id");
  if (error) throw dbError("applications update (move)", error);
  if ((data ?? []).length === 0) {
    // Changed in between (sync or another tab): the student reloads.
    throw new TrackerError("not_allowed");
  }
  if (to !== "sent") {
    // Out of "Envoyé": a follow-up draft no longer makes sense.
    const { error: fuError } = await admin
      .from("applications")
      .update({ followup_status: "dismissed", followup_approved_at: null })
      .eq("id", applicationId)
      .eq("user_id", userId)
      .eq("followup_status", "draft");
    if (fuError) throw dbError("applications update (dismiss follow-up)", fuError);
  }
  await logEvent(admin, userId, "card_moved", { from, to });
  return { changed: true, status: to };
}

/**
 * A mail to an address that does not exist goes back to the review screen
 * as a draft without recipient: the student picks another contact and
 * validates it again. Replies (the bounce) are kept.
 */
export async function reviseBounced(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const row = await loadOwned(admin, userId, applicationId);
  if (row.status !== "bounced") throw new TrackerError("not_allowed");

  const { data, error } = await admin
    .from("applications")
    .update({
      status: "draft",
      approved_at: null,
      scheduled_for: null,
      send_claimed_at: null,
      sent_at: null,
      gmail_message_id: null,
      gmail_thread_id: null,
      next_followup_at: null,
      contact_id: null,
      followup_status: null,
      followup_subject: null,
      followup_body: null,
      followup_approved_at: null,
      followup_sent_at: null,
      followup_error: null,
      followup_count: 0,
      last_reply_at: null,
      interview_notified_at: null,
      status_set_manually: false,
      send_error: BOUNCED_REVISE_ERROR,
    })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("status", "bounced")
    .select("id");
  if (error) throw dbError("applications update (revise)", error);
  if ((data ?? []).length === 0) throw new TrackerError("not_allowed");

  const { error: leadError } = await admin
    .from("leads")
    .update({ status: "drafted" })
    .eq("id", row.lead_id)
    .eq("user_id", userId);
  if (leadError) throw dbError("leads update (revise)", leadError);
  if (row.contact_id) {
    // The address does not exist: never offer it again.
    const { error: contactError } = await admin
      .from("contacts")
      .delete()
      .eq("id", row.contact_id)
      .eq("user_id", userId);
    if (contactError) throw dbError("contacts delete (revise)", contactError);
  }
  await logEvent(admin, userId, "bounced_revised", {});
}
