/**
 * "Entretien détecté" notification (SPEC §8.2, §15). SERVER ONLY.
 *
 * One short French mail sent from the student's Gmail to the student's own
 * Gmail address (no Resend). Never counts against the 20 / 24 h application
 * quota (it is not an application and has no recipient other than the
 * student). Idempotent: `applications.interview_notified_at` is claimed with
 * a conditional update BEFORE the send and released if the send fails, so
 * the student is notified at most once per application.
 * Never logs mail contents, addresses or tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import { getValidAccessToken } from "@/lib/google/connection";
import { buildMimeMessage, textToHtml } from "@/lib/hunter/mime";
import { GmailSendError, sendRawMessage } from "@/lib/integrations/gmail";

export type NotifyDeps = {
  getValidAccessToken: (
    admin: SupabaseClient,
    userId: string,
  ) => Promise<{ accessToken: string; email: string }>;
  sendRawMessage: (accessToken: string, raw: string) => Promise<{ id: string; threadId: string }>;
  /** Base URL of the app (APP_URL); null when not configured. */
  appUrl: () => string | null;
  now: () => Date;
};

const defaultDeps: NotifyDeps = {
  getValidAccessToken: (admin, userId) => getValidAccessToken(admin, userId),
  sendRawMessage: (accessToken, raw) => sendRawMessage(accessToken, raw),
  appUrl: () => {
    try {
      return getAppUrl();
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

export type NotifyInterviewInput = {
  userId: string;
  applicationId: string;
  companyName: string | null;
};

export type NotifyOutcome = "sent" | "already_notified" | "failed";

/** Company name safe for a header and a sentence. */
function displayCompany(name: string | null): string {
  const clean = (name ?? "")
    .replace(/[\r\n\t\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "une entreprise";
}

export function buildInterviewNotification(
  companyName: string | null,
  appUrl: string | null,
): { subject: string; text: string } {
  const company = displayCompany(companyName);
  const link = appUrl ? `${appUrl.replace(/\/+$/, "")}/tracker` : null;
  const text = [
    "Bonne nouvelle !",
    "",
    `${company} a répondu à ta candidature spontanée et la réponse ressemble à une proposition d'entretien ou d'appel.`,
    "",
    link
      ? `Retrouve la réponse et l'action conseillée dans ton suivi : ${link}`
      : "Retrouve la réponse et l'action conseillée dans ton suivi Spontané.",
    "",
    "Réponds vite (idéalement dans la journée) en proposant deux ou trois créneaux.",
    "",
    "— Spontané",
  ].join("\n");
  return { subject: `Entretien proposé par ${company} – Spontané`, text };
}

function logFailure(step: string, err: unknown) {
  const extra: Record<string, unknown> = { name: err instanceof Error ? err.name : typeof err };
  if (err instanceof GmailSendError) extra.status = err.status;
  console.error(`[tracker] notify ${step} failed`, extra);
}

/**
 * Notifies the student that `applicationId` got an interview proposal. Sends
 * at most once per application. Never throws.
 */
export async function notifyInterview(
  admin: SupabaseClient,
  input: NotifyInterviewInput,
  deps: Partial<NotifyDeps> = {},
): Promise<NotifyOutcome> {
  const d: NotifyDeps = { ...defaultDeps, ...deps };
  const claimedAt = d.now().toISOString();

  // 1. Claim (compare-and-swap on interview_notified_at).
  const { data: claimed, error: claimError } = await admin
    .from("applications")
    .update({ interview_notified_at: claimedAt })
    .eq("id", input.applicationId)
    .eq("user_id", input.userId)
    .is("interview_notified_at", null)
    .select("id");
  if (claimError) {
    logFailure("claim", claimError);
    return "failed";
  }
  if (!Array.isArray(claimed) || claimed.length !== 1) return "already_notified";

  const release = async () => {
    const { error } = await admin
      .from("applications")
      .update({ interview_notified_at: null })
      .eq("id", input.applicationId)
      .eq("user_id", input.userId)
      .eq("interview_notified_at", claimedAt);
    if (error) logFailure("release", error);
  };

  // 2. Send to the student's own address.
  try {
    const token = await d.getValidAccessToken(admin, input.userId);
    const { subject, text } = buildInterviewNotification(input.companyName, d.appUrl());
    const raw = buildMimeMessage({
      from: { name: "Spontané", email: token.email },
      to: token.email,
      subject,
      text,
      html: textToHtml(text),
    });
    await d.sendRawMessage(token.accessToken, raw);
    return "sent";
  } catch (err) {
    logFailure("send", err);
    // Timeout / network during the send: it may have left, never send twice.
    if (!(err instanceof GmailSendError && err.status === 0)) await release();
    return "failed";
  }
}
