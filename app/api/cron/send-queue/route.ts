import { isAuthorizedCron } from "@/lib/auth/cron";
import { getCronSecret } from "@/lib/env";
import { processSendQueue } from "@/lib/hunter/send";
import { createAdminClient } from "@/lib/supabase/admin";

/** Vercel function ceiling for this route; the worker stops starting sends at 50 s. */
export const maxDuration = 60;

/**
 * POST /api/cron/send-queue — called every minute by pg_cron (SPEC §7.6, §15)
 * with `Authorization: Bearer ${CRON_SECRET}`. Sends the due validated mails
 * and returns counts only (no content, no address).
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processSendQueue(createAdminClient(), { deadlineMs: 50_000 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron] send-queue failed", { name: err instanceof Error ? err.name : "" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
