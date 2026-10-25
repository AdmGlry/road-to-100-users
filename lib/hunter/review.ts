/**
 * Review screen read model and mutations (SPEC §7.6). SERVER ONLY.
 *
 * Every function takes the signed-in user's Supabase client (RLS applies)
 * and the user id verified from the session by the caller. Mutations are
 * conditional updates (status / claim filters in the WHERE clause), so a
 * mail the send worker has already claimed can never be edited, and an
 * edited mail can never be sent with its old validation.
 *
 * Errors thrown to the Server Actions are `ReviewError` (French, user-safe
 * message). Mail contents and e-mail addresses are never logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getGmailStatus } from "@/lib/google/connection";
import {
  PREP_STALE_MS,
  type ApplicationStatus,
  type Contact,
  type ContactConfidence,
  type ContactSource,
  type PreparingLead,
  type PrepStatus,
  type ReviewItem,
  type ReviewState,
} from "@/lib/hunter/application-types";
import { getSendQuota } from "@/lib/quotas";

import { headcountLabel, normalizeHeadcountCode } from "./headcount";

/** Sent mails stay visible on the review screen for this long. */
export const SENT_VISIBLE_MS = 24 * 60 * 60 * 1000;
/** Hard limits on what the student may save (the soft rules are shown in the UI). */
export const SUBJECT_HARD_MAX = 120;
export const BODY_HARD_MAX = 5000;

export type ReviewErrorCode =
  "not_found" | "locked" | "invalid" | "no_contact" | "invalid_email" | "empty" | "db";

const REVIEW_MESSAGES: Record<ReviewErrorCode, string> = {
  not_found: "Ce mail est introuvable. Recharge la page.",
  locked:
    "Ce mail est déjà en cours d'envoi ou envoyé : il ne peut plus être modifié. Recharge la page.",
  invalid: "Certaines informations ne sont pas valides. Vérifie puis réessaie.",
  no_contact: "Ajoute une adresse de destinataire avant de valider ce mail.",
  invalid_email: "Cette adresse e-mail n'est pas valide. Vérifie-la puis réessaie.",
  empty: "L'objet et le texte du mail ne peuvent pas être vides.",
  db: "Ton changement n'a pas été enregistré. Vérifie ta connexion puis réessaie.",
};

export class ReviewError extends Error {
  readonly userMessage: string;
  constructor(
    readonly code: ReviewErrorCode,
    options?: { cause?: unknown; message?: string },
  ) {
    super(`review: ${code}`, options?.cause ? { cause: options.cause } : undefined);
    this.name = "ReviewError";
    this.userMessage = options?.message ?? REVIEW_MESSAGES[code];
  }
}

function dbError(what: string, error: { code?: string } | null): ReviewError {
  return new ReviewError("db", {
    cause: new Error(`${what} failed (${error?.code ?? "unknown"})`),
  });
}

// ---------------------------------------------------------------------------
// Validation (shared by the Server Actions)
// ---------------------------------------------------------------------------

/** Header values must never contain CR/LF (MIME header injection). */
const oneLine = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

export const mailContentSchema = z.object({
  subject: z.string().transform(oneLine).pipe(z.string().min(1).max(SUBJECT_HARD_MAX)),
  body: z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1).max(BODY_HARD_MAX)),
});
export type MailContent = z.infer<typeof mailContentSchema>;

const nameSchema = z
  .string()
  .transform(oneLine)
  .pipe(z.string().max(80))
  .optional()
  .transform((s) => (s ? s : null));

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const changeContactInputSchema = z.union([
  z.object({ contactId: z.uuid() }).strict(),
  z
    .object({
      email: emailSchema,
      first_name: nameSchema,
      last_name: nameSchema,
    })
    .strict(),
]);
export type ChangeContactInput = z.input<typeof changeContactInputSchema>;

/** True when `email` is a syntactically valid address (same rule as the inputs). */
export function isValidEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && emailSchema.safeParse(email).success;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const APPLICATION_COLUMNS =
  "id, lead_id, contact_id, subject, body, company_insight, company_insight_source, " +
  "claims_unverified, quality_warnings, status, approved_at, scheduled_for, sent_at, send_error, edited_by_user, created_at";

type ApplicationRow = {
  id: string;
  lead_id: string;
  contact_id: string | null;
  subject: string | null;
  body: string | null;
  company_insight: string | null;
  company_insight_source: string | null;
  claims_unverified: string[] | null;
  quality_warnings: string[] | null;
  status: ApplicationStatus;
  approved_at: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  send_error: string | null;
  edited_by_user: boolean | null;
  created_at: string | null;
};

type LeadRow = {
  id: string;
  fit_score: number | null;
  establishment_city?: string | null;
  company: {
    name: string;
    city: string | null;
    naf_label: string | null;
    headcount_range: string | null;
    website: string | null;
  } | null;
};

type ContactRow = {
  id: string;
  lead_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string;
  source: ContactSource;
  confidence: ContactConfidence;
  created_at?: string | null;
};

type PrepLeadRow = {
  id: string;
  prep_status: PrepStatus | null;
  prep_error: string | null;
  prep_started_at: string | null;
  company: { name: string } | null;
};

const CONFIDENCE_RANK: Record<ContactConfidence, number> = { high: 0, medium: 1, low: 2 };

/** Best candidates first (confidence, then insertion order). */
export function sortContacts<
  T extends { confidence: ContactConfidence; created_at?: string | null },
>(contacts: readonly T[]): T[] {
  return [...contacts].sort(
    (a, b) =>
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    email: row.email,
    source: row.source,
    confidence: row.confidence,
  };
}

/** True for statuses that left the review screen's control (already sent). */
export function isSentStatus(status: ApplicationStatus): boolean {
  return status !== "draft" && status !== "approved";
}

/**
 * Review order: mails still to handle first (best fit, then oldest — the
 * order never changes when a mail is validated, so cards do not jump), then
 * sent mails, most recent first.
 */
export function sortReviewItems<
  T extends { item: ReviewItem; fit: number | null; created: string },
>(rows: readonly T[]): ReviewItem[] {
  return [...rows]
    .sort((a, b) => {
      const sa = isSentStatus(a.item.status) ? 1 : 0;
      const sb = isSentStatus(b.item.status) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      if (sa === 1) return String(b.item.sent_at ?? "").localeCompare(String(a.item.sent_at ?? ""));
      return (b.fit ?? -1) - (a.fit ?? -1) || a.created.localeCompare(b.created);
    })
    .map((r) => r.item);
}

/**
 * Builds the review state of the signed-in user: mails not sent yet + mails
 * sent in the last 24 h, the leads still in preparation (or failed), the
 * send quota and the Gmail connection status.
 */
export async function loadReviewState(
  supabase: SupabaseClient,
  userId: string,
  opts: { now?: Date } = {},
): Promise<ReviewState> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - SENT_VISIBLE_MS).toISOString();

  const [pendingRes, sentRes, prepRes, quota, gmail] = await Promise.all([
    supabase
      .from("applications")
      .select(APPLICATION_COLUMNS)
      .eq("user_id", userId)
      .in("status", ["draft", "approved"])
      .limit(200),
    supabase
      .from("applications")
      .select(APPLICATION_COLUMNS)
      .eq("user_id", userId)
      .gte("sent_at", since)
      .limit(200),
    supabase
      .from("leads")
      .select("id, prep_status, prep_error, prep_started_at, company:companies(name)")
      .eq("user_id", userId)
      .in("prep_status", ["queued", "running", "failed"])
      .limit(200),
    getSendQuota(supabase, userId),
    getGmailStatus(supabase),
  ]);
  if (pendingRes.error) throw dbError("applications select", pendingRes.error);
  if (sentRes.error) throw dbError("applications select (sent)", sentRes.error);
  if (prepRes.error) throw dbError("leads select (prep)", prepRes.error);

  const apps = new Map<string, ApplicationRow>();
  for (const row of [
    ...((pendingRes.data ?? []) as unknown as ApplicationRow[]),
    ...((sentRes.data ?? []) as unknown as ApplicationRow[]),
  ]) {
    apps.set(row.id, row);
  }
  const leadIds = [...new Set([...apps.values()].map((a) => a.lead_id))];

  let leads: LeadRow[] = [];
  let contacts: ContactRow[] = [];
  if (leadIds.length > 0) {
    const [leadsRes, contactsRes] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "id, fit_score, establishment_city, company:companies(name, city, naf_label, headcount_range, website)",
        )
        .eq("user_id", userId)
        .in("id", leadIds),
      supabase
        .from("contacts")
        .select("id, lead_id, first_name, last_name, role, email, source, confidence, created_at")
        .eq("user_id", userId)
        .in("lead_id", leadIds),
    ]);
    if (leadsRes.error) throw dbError("leads select", leadsRes.error);
    if (contactsRes.error) throw dbError("contacts select", contactsRes.error);
    leads = (leadsRes.data ?? []) as unknown as LeadRow[];
    contacts = (contactsRes.data ?? []) as unknown as ContactRow[];
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const contactsByLead = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const list = contactsByLead.get(c.lead_id) ?? [];
    list.push(c);
    contactsByLead.set(c.lead_id, list);
  }

  const rows = [...apps.values()].flatMap((a) => {
    const lead = leadById.get(a.lead_id);
    if (!lead?.company) return [];
    const leadContacts = sortContacts(contactsByLead.get(a.lead_id) ?? []).map(toContact);
    const item: ReviewItem = {
      applicationId: a.id,
      leadId: a.lead_id,
      company: {
        name: lead.company.name,
        city: lead.establishment_city ?? lead.company.city,
        activity: lead.company.naf_label,
        headcount_label: headcountLabel(normalizeHeadcountCode(lead.company.headcount_range)),
        website: lead.company.website,
      },
      contact: leadContacts.find((c) => c.id === a.contact_id) ?? null,
      contacts: leadContacts,
      subject: a.subject ?? "",
      body: a.body ?? "",
      company_insight: a.company_insight,
      company_insight_source: a.company_insight_source,
      claims_unverified: a.claims_unverified ?? [],
      quality_warnings: a.quality_warnings ?? [],
      status: a.status,
      approved_at: a.approved_at,
      scheduled_for: a.scheduled_for,
      sent_at: a.sent_at,
      send_error: a.send_error,
      edited_by_user: Boolean(a.edited_by_user),
    };
    return [{ item, fit: lead.fit_score, created: String(a.created_at ?? "") }];
  });

  const withApplication = new Set(rows.map((r) => r.item.leadId));
  const preparing: PreparingLead[] = ((prepRes.data ?? []) as unknown as PrepLeadRow[])
    .filter((l) => l.prep_status && !withApplication.has(l.id))
    .map((l) => ({
      leadId: l.id,
      companyName: l.company?.name ?? "Entreprise",
      prep_status: l.prep_status as PrepStatus,
      prep_error: l.prep_error,
    }));

  return { items: sortReviewItems(rows), preparing, quota, gmail };
}

/**
 * Whether a new background preparation run should be started: queued leads
 * with no live runner, or a runner that stopped (stale "running" lead).
 */
export function shouldResumePreparation(
  leads: readonly { prep_status: string | null; prep_started_at: string | null }[],
  now: Date = new Date(),
): boolean {
  let queued = 0;
  let live = 0;
  let stale = 0;
  for (const l of leads) {
    if (l.prep_status === "queued") queued += 1;
    if (l.prep_status === "running") {
      const started = l.prep_started_at ? Date.parse(l.prep_started_at) : NaN;
      if (Number.isFinite(started) && now.getTime() - started < PREP_STALE_MS) live += 1;
      else stale += 1;
    }
  }
  return stale > 0 || (queued > 0 && live === 0);
}

/** Reads the preparation queue of the user and applies shouldResumePreparation. */
export async function needsPreparationRun(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, prep_status, prep_started_at")
    .eq("user_id", userId)
    .in("prep_status", ["queued", "running"])
    .limit(200);
  if (error) throw dbError("leads select (prep queue)", error);
  return shouldResumePreparation(
    (data ?? []) as { prep_status: string | null; prep_started_at: string | null }[],
    now,
  );
}

/** Whether validated mails of the user are due now (send queue to process). */
export async function hasDueSends(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("approved_at", "is", null)
    .lte("scheduled_for", now.toISOString())
    .limit(1);
  if (error) throw dbError("applications select (due)", error);
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type EditableRow = {
  id: string;
  lead_id: string;
  contact_id: string | null;
  status: ApplicationStatus;
  subject: string | null;
  body: string | null;
  scheduled_for: string | null;
  send_claimed_at: string | null;
};

const EDITABLE_COLUMNS =
  "id, lead_id, contact_id, status, subject, body, scheduled_for, send_claimed_at";

/** Back to draft: the student has to validate again (and the queue slot is freed). */
const BACK_TO_DRAFT = { status: "draft", approved_at: null, scheduled_for: null } as const;

/** Loads an application the user may still change (draft, or approved and not being sent). */
async function loadEditable(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<EditableRow> {
  const { data, error } = await supabase
    .from("applications")
    .select(EDITABLE_COLUMNS)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("applications select (editable)", error);
  if (!data) throw new ReviewError("not_found");
  const row = data as unknown as EditableRow;
  if ((row.status !== "draft" && row.status !== "approved") || row.send_claimed_at) {
    throw new ReviewError("locked");
  }
  return row;
}

/**
 * Conditional update: only applies while the mail is still a draft or a
 * validated mail the send worker has not claimed. Returns false when the
 * row changed in between (then the caller reports "locked").
 */
async function updateIfEditable(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  patch: Record<string, unknown>,
  allowed: readonly ApplicationStatus[] = ["draft", "approved"],
): Promise<boolean> {
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .in("status", [...allowed])
    .is("send_claimed_at", null)
    .select("id");
  if (error) throw dbError("applications update", error);
  return (data ?? []).length > 0;
}

export type MutationResult = { changed: boolean; status: ApplicationStatus };

/**
 * Saves the student's edit. Any real change to a validated mail sets it back
 * to draft (validation removed, unqueued): it must be validated again.
 */
export async function updateApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  content: MailContent,
): Promise<MutationResult> {
  const row = await loadEditable(supabase, userId, applicationId);
  if (row.subject === content.subject && row.body === content.body) {
    return { changed: false, status: row.status };
  }
  const ok = await updateIfEditable(supabase, userId, applicationId, {
    subject: content.subject,
    body: content.body,
    edited_by_user: true,
    send_error: null,
    ...BACK_TO_DRAFT,
  });
  if (!ok) throw new ReviewError("locked");
  return { changed: true, status: "draft" };
}

/** Explicit human validation. Requires a recipient with a valid address. */
export async function approveApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  now: Date = new Date(),
): Promise<MutationResult> {
  const row = await loadEditable(supabase, userId, applicationId);
  if (row.status === "approved") return { changed: false, status: "approved" };
  if (!row.subject?.trim() || !row.body?.trim()) throw new ReviewError("empty");
  if (!row.contact_id) throw new ReviewError("no_contact");

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, email")
    .eq("id", row.contact_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("contacts select", error);
  if (!contact) throw new ReviewError("no_contact");
  if (!isValidEmail((contact as { email: string }).email)) throw new ReviewError("invalid_email");

  const ok = await updateIfEditable(
    supabase,
    userId,
    applicationId,
    { status: "approved", approved_at: now.toISOString(), scheduled_for: null, send_error: null },
    ["draft"],
  );
  if (!ok) throw new ReviewError("locked");
  return { changed: true, status: "approved" };
}

/**
 * Removes the validation (also cancels a queued send that has not started:
 * the send worker only picks approved mails it can claim).
 */
export async function unapproveApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<MutationResult> {
  const row = await loadEditable(supabase, userId, applicationId);
  if (row.status === "draft") return { changed: false, status: "draft" };
  const ok = await updateIfEditable(supabase, userId, applicationId, { ...BACK_TO_DRAFT }, [
    "approved",
  ]);
  if (!ok) throw new ReviewError("locked");
  return { changed: true, status: "draft" };
}

/** Deletes the mail and dismisses the company (it will not be proposed again). */
export async function dismissApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .eq("user_id", userId)
    .in("status", ["draft", "approved"])
    .is("send_claimed_at", null)
    .select("id, lead_id");
  if (error) throw dbError("applications delete", error);
  const deleted = (data ?? []) as { id: string; lead_id: string }[];
  if (deleted.length === 0) {
    // Either unknown or already being sent: tell which.
    await loadEditable(supabase, userId, applicationId);
    throw new ReviewError("locked");
  }
  const { error: leadError } = await supabase
    .from("leads")
    .update({ status: "dismissed", prep_status: null, prep_error: null })
    .eq("id", deleted[0].lead_id)
    .eq("user_id", userId);
  if (leadError) throw dbError("leads update (dismiss)", leadError);
}

/** Removes a company whose preparation failed from the queue (lead dismissed). */
export async function dismissFailedLead(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("leads")
    .update({ status: "dismissed", prep_status: null, prep_error: null })
    .eq("id", leadId)
    .eq("user_id", userId)
    .eq("prep_status", "failed")
    .select("id");
  if (error) throw dbError("leads update (dismiss failed)", error);
  if ((data ?? []).length === 0) throw new ReviewError("not_found");
}

/** "Bonjour Prénom Nom," when the name is known, else "Bonjour,". */
export function greetingFor(contact: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const name = [contact.first_name, contact.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  return name ? `Bonjour ${name},` : "Bonjour,";
}

/**
 * Replaces the greeting on the first line of the mail ("Bonjour …,") with
 * the one for the new recipient. Any other first line is left untouched.
 */
export function adaptGreeting(
  body: string,
  contact: { first_name: string | null; last_name: string | null },
): string {
  const match = /^(\s*)bonjour\b[^\n,]{0,80},[ \t]*(?=\n|$)/i.exec(body);
  if (!match) return body;
  return match[1] + greetingFor(contact) + body.slice(match[0].length);
}

/**
 * Changes the recipient: an existing candidate of the same lead, or a new
 * address typed by the student (source user_input, confidence high). A
 * validated mail goes back to draft. The greeting line follows the recipient.
 */
export async function changeContact(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  input: z.output<typeof changeContactInputSchema>,
): Promise<MutationResult & { contactId: string }> {
  const row = await loadEditable(supabase, userId, applicationId);

  let contact: { id: string; first_name: string | null; last_name: string | null };
  if ("contactId" in input) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, lead_id, first_name, last_name, email")
      .eq("id", input.contactId)
      .eq("user_id", userId)
      .eq("lead_id", row.lead_id)
      .maybeSingle();
    if (error) throw dbError("contacts select", error);
    if (!data) throw new ReviewError("not_found", { message: "Ce contact est introuvable." });
    contact = data as { id: string; first_name: string | null; last_name: string | null };
  } else {
    const { data: existing, error: findError } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("user_id", userId)
      .eq("lead_id", row.lead_id)
      .eq("email", input.email)
      .limit(1);
    if (findError) throw dbError("contacts select (email)", findError);
    const found = (existing ?? [])[0] as
      { id: string; first_name: string | null; last_name: string | null } | undefined;
    if (found) {
      const names = {
        first_name: input.first_name ?? found.first_name,
        last_name: input.last_name ?? found.last_name,
      };
      const { error: updError } = await supabase
        .from("contacts")
        .update({ ...names, source: "user_input", confidence: "high" })
        .eq("id", found.id)
        .eq("user_id", userId);
      if (updError) throw dbError("contacts update", updError);
      contact = { id: found.id, ...names };
    } else {
      const { data: created, error: insError } = await supabase
        .from("contacts")
        .insert({
          user_id: userId,
          lead_id: row.lead_id,
          email: input.email,
          first_name: input.first_name,
          last_name: input.last_name,
          role: null,
          source: "user_input",
          confidence: "high",
        })
        .select("id, first_name, last_name")
        .single();
      if (insError || !created) throw dbError("contacts insert", insError);
      contact = created as { id: string; first_name: string | null; last_name: string | null };
    }
  }

  const body = adaptGreeting(row.body ?? "", contact);
  const ok = await updateIfEditable(supabase, userId, applicationId, {
    contact_id: contact.id,
    ...(body !== (row.body ?? "") ? { body } : {}),
    send_error: null,
    ...BACK_TO_DRAFT,
  });
  if (!ok) throw new ReviewError("locked");
  return { changed: true, status: "draft", contactId: contact.id };
}

/**
 * Before a regeneration: checks ownership with the user client and sets a
 * validated mail back to draft (regeneration only applies to drafts).
 */
export async function prepareRegeneration(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const row = await loadEditable(supabase, userId, applicationId);
  if (row.status === "approved") {
    const ok = await updateIfEditable(supabase, userId, applicationId, { ...BACK_TO_DRAFT }, [
      "approved",
    ]);
    if (!ok) throw new ReviewError("locked");
  }
}

/** Ids of the validated mails not queued yet (for the confirmation step). */
export async function listApprovedUnqueued(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("approved_at", "is", null)
    .is("scheduled_for", null)
    .limit(200);
  if (error) throw dbError("applications select (approved)", error);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
