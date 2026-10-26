/**
 * Send quota and spacing (SPEC §7.6): 20 sends per user per rolling 24 h,
 * 30–90 s random spacing between two sends of the same user.
 *
 * The quota is enforced server side by `reserve_send_slot()` (atomic: per-user
 * advisory lock + count + insert into `send_log`, service role only). The
 * count shown to the student (getSendQuota) is informative only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SEND_LIMIT_PER_24H,
  SEND_SPACING_MAX_S,
  SEND_SPACING_MIN_S,
  type SendQuota,
} from "@/lib/hunter/application-types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Random gap between two sends, in milliseconds (30–90 s). */
export function sendSpacingMs(rand: () => number = Math.random): number {
  const r = Math.min(Math.max(rand(), 0), 1);
  return Math.round((SEND_SPACING_MIN_S + r * (SEND_SPACING_MAX_S - SEND_SPACING_MIN_S)) * 1000);
}

/**
 * Send times for `count` mails: the first at max(startAt, last + spacing),
 * then one every 30–90 s.
 */
export function computeSendSchedule(
  count: number,
  startAt: Date,
  lastScheduledAt: Date | null,
  rand: () => number = Math.random,
): Date[] {
  const out: Date[] = [];
  if (count <= 0) return out;
  let t = startAt.getTime();
  if (lastScheduledAt) t = Math.max(t, lastScheduledAt.getTime() + sendSpacingMs(rand));
  out.push(new Date(t));
  for (let i = 1; i < count; i++) {
    t += sendSpacingMs(rand);
    out.push(new Date(t));
  }
  return out;
}

/** Quota of `userId` (user client: RLS lets students read their own send_log). */
export async function getSendQuota(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<SendQuota> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const [sent, queued] = await Promise.all([
    supabase
      .from("send_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("sent_at", since),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("scheduled_for", "is", null),
  ]);
  if (sent.error) throw new Error(`send_log count failed (${sent.error.code ?? "unknown"})`);
  if (queued.error) {
    throw new Error(`applications count failed (${queued.error.code ?? "unknown"})`);
  }
  const used = sent.count ?? 0;
  const queuedCount = queued.count ?? 0;
  return {
    used,
    limit: SEND_LIMIT_PER_24H,
    queued: queuedCount,
    remaining: Math.max(0, SEND_LIMIT_PER_24H - used - queuedCount),
  };
}

/** Another send of the student left less than 30 s ago: retry later (SPEC §7.6 spacing). */
export class SendTooSoonError extends Error {
  constructor() {
    super("send too soon after the previous one");
    this.name = "SendTooSoonError";
  }
}

/**
 * Atomically reserves one send in the rolling 24 h quota (service-role
 * client). Returns the send_log id, or null when the quota is reached.
 * Throws SendTooSoonError when the previous send is less than 30 s old.
 */
export async function reserveSendSlot(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("reserve_send_slot", {
    p_user: userId,
    p_application: applicationId,
    p_limit: SEND_LIMIT_PER_24H,
  });
  if (error && /send_too_soon/.test(error.message ?? "")) throw new SendTooSoonError();
  if (error) throw new Error(`reserve_send_slot failed (${error.code ?? "unknown"})`);
  return typeof data === "string" && data.length > 0 ? data : null;
}

/** Gives a reserved slot back (only when the mail certainly did not leave). */
export async function releaseSendSlot(admin: SupabaseClient, slotId: string): Promise<void> {
  const { error } = await admin.from("send_log").delete().eq("id", slotId);
  if (error) throw new Error(`send_log delete failed (${error.code ?? "unknown"})`);
}
