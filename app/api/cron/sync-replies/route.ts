import { isAuthorizedCron } from "@/lib/auth/cron";
import { getCronSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncReplies } from "@/lib/tracker/sync";

/** Vercel function ceiling for this route; the sync stops starting work at 50 s. */
export const maxDuration = 60;

/**
 * POST /api/cron/sync-replies — called every hour by pg_cron (SPEC §8.1, §9)
 * with `Authorization: Bearer ${CRON_SECRET}`. Reads the replies of the app's
 * own Gmail threads and returns counts only (no content, no address).
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
    const result = await syncReplies(createAdminClient(), { deadlineMs: 50_000 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron] sync-replies failed", { name: err instanceof Error ? err.name : "" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
