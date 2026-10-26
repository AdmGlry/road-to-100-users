"use server";

/**
 * Server Actions of the tracker board (SPEC §8.3, §8.4).
 *
 * Same rules as app/(app)/hunter/review/actions.ts: every action re-reads the
 * signed-in user from the Supabase session (never a user id from the
 * client) and validates its input with Zod. Reads use the user's client
 * (RLS). Sent applications are read-only for clients, so the mutations run
 * on the service-role client, always filtered on the verified user id (the
 * lib functions re-check ownership and the allowed transitions).
 * Errors are returned as French messages; only error names/codes are logged
 * (never mail contents, snippets or e-mail addresses).
 */
import { z } from "zod";

import { getGmailStatus } from "@/lib/google/connection";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadTrackerState, moveCard, reviseBounced, TrackerError } from "@/lib/tracker/board";
import {
  dismissFollowup,
  FollowupError,
  sendFollowup,
  updateFollowup,
} from "@/lib/tracker/followups";
import { syncReplies } from "@/lib/tracker/sync";
import {
  MANUAL_SYNC_COOLDOWN_MIN,
  TRACKER_COLUMNS,
  type TrackerColumn,
  type TrackerState,
} from "@/lib/tracker/types";

/** Budget of a manual sync, within the page's maxDuration (60 s). */
const MANUAL_SYNC_DEADLINE_MS = 25_000;
const MANUAL_SYNC_EVENT = "manual_sync";
/** Hard limits on a follow-up the student edits (the 50–80 words rule is shown in the UI). */
const FOLLOWUP_SUBJECT_MAX = 120;
const FOLLOWUP_BODY_MAX = 2000;

const SESSION_EXPIRED = "Ta session a expiré. Reconnecte-toi puis réessaie.";
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const NOT_FOUND = "Cette candidature est introuvable. Recharge la page.";
const LOAD_ERROR = "Impossible de charger ton suivi. Vérifie ta connexion puis réessaie.";
const NOT_CONFIGURED =
  "Le suivi n'est pas encore configuré sur ce serveur. Contacte l'administrateur de Spontané.";
const GMAIL_REQUIRED =
  "Connecte ton Gmail (ou reconnecte-le) : le suivi et les relances passent par ta propre adresse.";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export type TrackerStateResult = ActionResult<{ state: TrackerState }>;
export type SyncResult = ActionResult<{ state: TrackerState; newReplies: number }>;

const idSchema = z.uuid();
const columnSchema = z.enum(
  TRACKER_COLUMNS.map((c) => c.id) as [TrackerColumn, ...TrackerColumn[]],
);
const oneLine = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
const followupInputSchema = z.object({
  subject: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1).max(FOLLOWUP_SUBJECT_MAX))
    .optional(),
  body: z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1).max(FOLLOWUP_BODY_MAX)),
});

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Logs a failure without its message (it could quote mail data). */
function logFailure(action: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`[tracker] ${action} failed`, {
    name: err instanceof Error ? err.name : typeof err,
    code,
  });
}

function errorMessage(err: unknown, fallback = GENERIC_ERROR): string {
  if (err instanceof TrackerError || err instanceof FollowupError) return err.userMessage;
  return fallback;
}

function tryAdmin(action: string): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch (err) {
    logFailure(`${action}.adminClient`, err);
    return null;
  }
}

async function stateResult(session: Session): Promise<TrackerStateResult> {
  try {
    return { ok: true, state: await loadTrackerState(session.supabase, session.user.id) };
  } catch (err) {
    logFailure("loadTrackerState", err);
    return { ok: false, message: LOAD_ERROR };
  }
}

async function gmailReady(session: Session): Promise<boolean> {
  const gmail = await getGmailStatus(session.supabase);
  return gmail.state === "active" && !gmail.missingScopes;
}

/** Shared skeleton of the mutations on one application. */
async function mutate(
  name: string,
  id: string,
  run: (admin: ReturnType<typeof createAdminClient>, session: Session, id: string) => Promise<void>,
  opts: { requireGmail?: boolean; fallback?: string } = {},
): Promise<TrackerStateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  try {
    if (opts.requireGmail && !(await gmailReady(session))) {
      return { ok: false, message: GMAIL_REQUIRED };
    }
    const admin = tryAdmin(name);
    if (!admin) return { ok: false, message: NOT_CONFIGURED };
    await run(admin, session, parsedId.data);
  } catch (err) {
    logFailure(name, err);
    return { ok: false, message: errorMessage(err, opts.fallback) };
  }
  return stateResult(session);
}

export async function refreshTrackerAction(): Promise<TrackerStateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  return stateResult(session);
}

function minutesLabel(n: number): string {
  return `${n} minute${n > 1 ? "s" : ""}`;
}

/**
 * "Synchroniser maintenant": reads the replies of the student's own threads
 * right away (the hourly cron does it otherwise). At most once every
 * MANUAL_SYNC_COOLDOWN_MIN minutes per student (`events` row `manual_sync`).
 */
export async function syncNowAction(): Promise<SyncResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const userId = session.user.id;
  try {
    if (!(await gmailReady(session))) return { ok: false, message: GMAIL_REQUIRED };
    const admin = tryAdmin("syncNow");
    if (!admin) return { ok: false, message: NOT_CONFIGURED };

    const now = Date.now();
    const cooldownMs = MANUAL_SYNC_COOLDOWN_MIN * 60_000;
    const { data: recent, error: recentError } = await admin
      .from("events")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("name", MANUAL_SYNC_EVENT)
      .gte("created_at", new Date(now - cooldownMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (recentError) throw new Error(`events select failed (${recentError.code ?? "unknown"})`);
    const last = (recent ?? [])[0] as { created_at?: string } | undefined;
    if (last) {
      const lastMs = Date.parse(String(last.created_at ?? ""));
      const waitMin = Number.isFinite(lastMs)
        ? Math.max(1, Math.ceil((lastMs + cooldownMs - now) / 60_000))
        : MANUAL_SYNC_COOLDOWN_MIN;
      return {
        ok: false,
        message: `Tu viens de synchroniser. Réessaie dans ${minutesLabel(waitMin)} (la synchronisation automatique a lieu toutes les heures).`,
      };
    }

    const { error: insertError } = await admin
      .from("events")
      .insert({ user_id: userId, name: MANUAL_SYNC_EVENT, props: {} });
    if (insertError) throw new Error(`events insert failed (${insertError.code ?? "unknown"})`);

    const result = await syncReplies(admin, { userId, deadlineMs: MANUAL_SYNC_DEADLINE_MS });
    const state = await stateResult(session);
    if (!state.ok) return state;
    return { ok: true, state: state.state, newReplies: result.newReplies };
  } catch (err) {
    logFailure("syncNow", err);
    return {
      ok: false,
      message:
        "La synchronisation n'a pas abouti. Réessaie dans quelques minutes : la synchronisation automatique continue toutes les heures.",
    };
  }
}

/** "Déplacer vers": manual correction of the column (accessible alternative to drag-and-drop). */
export async function moveCardAction(
  id: string,
  column: TrackerColumn,
): Promise<TrackerStateResult> {
  const parsedColumn = columnSchema.safeParse(column);
  if (!parsedColumn.success) {
    const session = await getSession();
    if (!session) return { ok: false, message: SESSION_EXPIRED };
    return { ok: false, message: "Cette colonne n'existe pas. Recharge la page." };
  }
  return mutate("moveCard", id, async (admin, session, appId) => {
    await moveCard(admin, session.user.id, appId, parsedColumn.data);
  });
}

/** Bounced mail: back to the review screen to choose another contact. */
export async function reviseBouncedAction(id: string): Promise<TrackerStateResult> {
  return mutate("reviseBounced", id, async (admin, session, appId) => {
    await reviseBounced(admin, session.user.id, appId);
  });
}

export async function updateFollowupAction(
  id: string,
  input: { subject?: string; body: string },
): Promise<TrackerStateResult> {
  const parsed = followupInputSchema.safeParse(input);
  if (!parsed.success) {
    const session = await getSession();
    if (!session) return { ok: false, message: SESSION_EXPIRED };
    return {
      ok: false,
      message: `L'objet (${FOLLOWUP_SUBJECT_MAX} caractères max) et le texte de la relance (${FOLLOWUP_BODY_MAX} caractères max) ne peuvent pas être vides.`,
    };
  }
  return mutate("updateFollowup", id, async (admin, session, appId) => {
    await updateFollowup(admin, session.user.id, appId, parsed.data);
  });
}

/** Explicit validation + send of the follow-up, in the same Gmail thread. */
export async function sendFollowupAction(id: string): Promise<TrackerStateResult> {
  return mutate(
    "sendFollowup",
    id,
    async (admin, session, appId) => {
      await sendFollowup(admin, session.user.id, appId);
    },
    {
      requireGmail: true,
      fallback: "Ta relance n'est pas partie. Rien n'a été envoyé : réessaie dans un instant.",
    },
  );
}

export async function dismissFollowupAction(id: string): Promise<TrackerStateResult> {
  return mutate("dismissFollowup", id, async (admin, session, appId) => {
    await dismissFollowup(admin, session.user.id, appId);
  });
}
