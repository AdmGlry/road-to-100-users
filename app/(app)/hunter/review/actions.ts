"use server";

/**
 * Server Actions of the review screen (SPEC §7.6).
 *
 * Same rules as app/(app)/hunter/actions.ts: every action re-reads the
 * signed-in user from the Supabase session (never a user id from the
 * client), validates its input with Zod and uses the user's Supabase client
 * (RLS) for reads and writes. The service-role client is only handed to the
 * background jobs (`after()`: preparation, send queue) and to the
 * regeneration, always after an ownership check with the user client and
 * filtered on the verified user id.
 * Errors are returned as French messages; only error names/codes are logged
 * (never mail contents or e-mail addresses).
 */
import { after } from "next/server";
import { z } from "zod";

import { getGmailStatus } from "@/lib/google/connection";
import { MAX_PREPARE_AT_ONCE, type ReviewState } from "@/lib/hunter/application-types";
import {
  PrepareError,
  queuePreparation,
  regenerateApplication,
  runPreparation,
} from "@/lib/hunter/prepare";
import {
  approveApplication,
  changeContact,
  changeContactInputSchema,
  dismissApplication,
  dismissFailedLead,
  hasDueSends,
  loadReviewState,
  mailContentSchema,
  needsPreparationRun,
  prepareRegeneration,
  ReviewError,
  unapproveApplication,
  updateApplication,
  type ChangeContactInput,
} from "@/lib/hunter/review";
import { processSendQueue, queueApprovedApplications } from "@/lib/hunter/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Background budgets, within the page's maxDuration (300 s). */
const PREPARATION_DEADLINE_MS = 240_000;
const SEND_DEADLINE_MS = 50_000;

const SESSION_EXPIRED = "Ta session a expiré. Reconnecte-toi puis réessaie.";
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const NOT_CONFIGURED =
  "La préparation des candidatures n'est pas encore configurée sur ce serveur. Contacte l'administrateur de Spontané.";
const NOT_FOUND = "Ce mail est introuvable. Recharge la page.";
const LOAD_ERROR = "Impossible de charger tes mails. Vérifie ta connexion puis réessaie.";
const GMAIL_REQUIRED =
  "Connecte ton Gmail (ou reconnecte-le) avant d'envoyer tes mails : ils partent depuis ta propre adresse.";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export type StateResult = ActionResult<{ state: ReviewState }>;
export type StartPreparationResult = ActionResult<{ queued: number; requested: number }>;
export type SendApprovedResult = ActionResult<{
  queued: number;
  overQuota: number;
  state: ReviewState | null;
}>;
export type MutationActionResult = ActionResult<{ state: ReviewState | null }>;

const idSchema = z.uuid();
const leadIdsSchema = z.array(z.uuid()).min(1).max(100);
const sendIdsSchema = z.array(z.uuid()).min(1).max(100);

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Logs a failure without its message (it could quote mail or profile data). */
function logFailure(action: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`[review] ${action} failed`, {
    name: err instanceof Error ? err.name : typeof err,
    code,
  });
}

function errorMessage(err: unknown, fallback = GENERIC_ERROR): string {
  if (err instanceof ReviewError || err instanceof PrepareError) return err.userMessage;
  return fallback;
}

/** Fresh state after a mutation; null (not an error) if only the reload failed. */
async function freshState(session: Session): Promise<ReviewState | null> {
  try {
    return await loadReviewState(session.supabase, session.user.id);
  } catch (err) {
    logFailure("reloadState", err);
    return null;
  }
}

function tryAdmin(action: string): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch (err) {
    logFailure(`${action}.adminClient`, err);
    return null;
  }
}

/** Runs the preparation queue of `userId` after the response (never throws). */
function schedulePreparation(admin: ReturnType<typeof createAdminClient>, userId: string) {
  after(async () => {
    try {
      // Service-role client: every query in runPreparation is filtered on the
      // user id verified from the session. The cookie-bound client must not
      // be used after the response (it could rotate the refresh token).
      await runPreparation(admin, userId, { deadlineMs: PREPARATION_DEADLINE_MS });
    } catch (err) {
      logFailure("runPreparation", err);
    }
  });
}

/** Processes the due sends of `userId` after the response (never throws). */
function scheduleSends(admin: ReturnType<typeof createAdminClient>, userId: string) {
  after(async () => {
    try {
      await processSendQueue(admin, { userId, deadlineMs: SEND_DEADLINE_MS });
    } catch (err) {
      logFailure("processSendQueue", err);
    }
  });
}

export async function getReviewStateAction(): Promise<StateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  try {
    return { ok: true, state: await loadReviewState(session.supabase, session.user.id) };
  } catch (err) {
    logFailure("loadReviewState", err);
    return { ok: false, message: LOAD_ERROR };
  }
}

/**
 * Queues the selected leads for preparation (website, contact, hook, mail)
 * and starts the background run. The page then shows the progress.
 */
export async function startPreparationAction(leadIds: string[]): Promise<StartPreparationResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const ids = leadIdsSchema.safeParse(Array.isArray(leadIds) ? [...new Set(leadIds)] : leadIds);
  if (!ids.success) {
    return { ok: false, message: "Sélectionne au moins une entreprise à préparer." };
  }

  const admin = tryAdmin("startPreparation");
  if (!admin) return { ok: false, message: NOT_CONFIGURED };

  try {
    const { queued } = await queuePreparation(session.supabase, session.user.id, ids.data);
    // Also resumes leads queued earlier (e.g. a run cut by the time budget).
    if (queued > 0 || (await needsPreparationRun(session.supabase, session.user.id))) {
      schedulePreparation(admin, session.user.id);
    }
    return { ok: true, queued, requested: Math.min(ids.data.length, MAX_PREPARE_AT_ONCE) };
  } catch (err) {
    logFailure("startPreparation", err);
    return {
      ok: false,
      message: errorMessage(
        err,
        "Impossible de lancer la préparation pour le moment. Réessaie dans un instant.",
      ),
    };
  }
}

/**
 * Called by the open review page while leads are being prepared: restarts
 * the background run when it stopped (time budget) and returns the state.
 */
export async function continuePreparationAction(): Promise<StateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  try {
    if (await needsPreparationRun(session.supabase, session.user.id)) {
      const admin = tryAdmin("continuePreparation");
      if (admin) schedulePreparation(admin, session.user.id);
    }
    return { ok: true, state: await loadReviewState(session.supabase, session.user.id) };
  } catch (err) {
    logFailure("continuePreparation", err);
    return { ok: false, message: LOAD_ERROR };
  }
}

export async function updateApplicationAction(
  id: string,
  content: { subject: string; body: string },
): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  const parsed = mailContentSchema.safeParse(content);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "L'objet (120 caractères max) et le texte du mail (5 000 caractères max) ne peuvent pas être vides.",
    };
  }
  try {
    await updateApplication(session.supabase, session.user.id, parsedId.data, parsed.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("updateApplication", err);
    return { ok: false, message: errorMessage(err) };
  }
}

export async function approveApplicationAction(id: string): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  try {
    await approveApplication(session.supabase, session.user.id, parsedId.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("approveApplication", err);
    return { ok: false, message: errorMessage(err) };
  }
}

/** Removes the validation; also cancels a queued send that has not started yet. */
export async function unapproveApplicationAction(id: string): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  try {
    await unapproveApplication(session.supabase, session.user.id, parsedId.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("unapproveApplication", err);
    return { ok: false, message: errorMessage(err) };
  }
}

export async function dismissApplicationAction(id: string): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  try {
    await dismissApplication(session.supabase, session.user.id, parsedId.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("dismissApplication", err);
    return { ok: false, message: errorMessage(err) };
  }
}

/** Removes a company whose preparation failed. */
export async function dismissFailedLeadAction(leadId: string): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(leadId);
  if (!parsedId.success) return { ok: false, message: GENERIC_ERROR };
  try {
    await dismissFailedLead(session.supabase, session.user.id, parsedId.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("dismissFailedLead", err);
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * Rewrites the mail (≈ 20–40 s with the free models). Runs inside the
 * request (the student waits for the new text); ownership is checked with
 * the user client first and the service-role client is filtered on the
 * verified user id.
 */
export async function regenerateApplicationAction(id: string): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  const admin = tryAdmin("regenerate");
  if (!admin) return { ok: false, message: NOT_CONFIGURED };
  try {
    await prepareRegeneration(session.supabase, session.user.id, parsedId.data);
    await regenerateApplication(admin, session.user.id, parsedId.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("regenerateApplication", err);
    return {
      ok: false,
      message: errorMessage(
        err,
        "La régénération n'a pas abouti (le service est peut-être chargé). Ton mail actuel est conservé : réessaie dans un instant.",
      ),
    };
  }
}

export async function changeContactAction(
  id: string,
  input: ChangeContactInput,
): Promise<MutationActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: NOT_FOUND };
  const parsed = changeContactInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Cette adresse e-mail n'est pas valide. Vérifie-la puis réessaie.",
    };
  }
  try {
    await changeContact(session.supabase, session.user.id, parsedId.data, parsed.data);
    return { ok: true, state: await freshState(session) };
  } catch (err) {
    logFailure("changeContact", err);
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * Final human confirmation of the batch: queues exactly the validated mails
 * listed in the confirmation step (capped to the quota), spaced 30–90 s,
 * then starts sending the first ones after the response.
 */
export async function sendApprovedAction(applicationIds: string[]): Promise<SendApprovedResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const ids = sendIdsSchema.safeParse(
    Array.isArray(applicationIds) ? [...new Set(applicationIds)] : applicationIds,
  );
  if (!ids.success) return { ok: false, message: "Aucun mail validé à envoyer." };

  try {
    const gmail = await getGmailStatus(session.supabase);
    if (gmail.state !== "active" || gmail.missingScopes) {
      return { ok: false, message: GMAIL_REQUIRED };
    }
    const admin = tryAdmin("sendApproved");
    if (!admin) {
      return {
        ok: false,
        message:
          "L'envoi n'est pas encore configuré sur ce serveur. Contacte l'administrateur de Spontané.",
      };
    }

    const { queued, overQuota } = await queueApprovedApplications(
      session.supabase,
      session.user.id,
      ids.data,
    );
    if (queued > 0) scheduleSends(admin, session.user.id);
    return { ok: true, queued, overQuota, state: await freshState(session) };
  } catch (err) {
    logFailure("sendApproved", err);
    return {
      ok: false,
      message: "Tes mails n'ont pas pu être mis en file d'envoi. Rien n'est parti : réessaie.",
    };
  }
}

/**
 * Called every ~20 s by the open page while mails are queued: sends the due
 * ones (the per-minute cron does the same when the page is closed).
 */
export async function processMyQueueAction(): Promise<StateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  try {
    if (await hasDueSends(session.supabase, session.user.id)) {
      const gmail = await getGmailStatus(session.supabase);
      const admin = gmail.state === "active" ? tryAdmin("processMyQueue") : null;
      // Not connected: processSendQueue would unschedule the mails with a
      // clear message; the cron does it too, so only run it when active.
      if (admin) scheduleSends(admin, session.user.id);
    }
    return { ok: true, state: await loadReviewState(session.supabase, session.user.id) };
  } catch (err) {
    logFailure("processMyQueue", err);
    return { ok: false, message: LOAD_ERROR };
  }
}
