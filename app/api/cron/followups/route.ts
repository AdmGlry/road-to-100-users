import { isAuthorizedCron } from "@/lib/auth/cron";
import { getCronSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateFollowups, markNoReply } from "@/lib/tracker/followups";

/** Vercel function ceiling for this route. */
export const maxDuration = 60;

/**
 * No new draft is started after this: one composition (with its single
 * regeneration) can take 20–30 s on the free models, and must end before 60 s.
 */
const FOLLOWUP_CRON_DEADLINE_MS = 25_000;

/**
 * POST /api/cron/followups — called once a day by pg_cron (SPEC §8.3, §9)
 * with `Authorization: Bearer ${CRON_SECRET}`. Marks `no_reply`, then drafts
 * the due follow-ups (never sends anything). Returns counts only.
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
    const admin = createAdminClient();
    const noReply = await markNoReply(admin);
    const { drafted, failed } = await generateFollowups(admin, {
      deadlineMs: FOLLOWUP_CRON_DEADLINE_MS,
    });
    return Response.json(
      { noReply, drafted, failed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[cron] followups failed", { name: err instanceof Error ? err.name : "" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
