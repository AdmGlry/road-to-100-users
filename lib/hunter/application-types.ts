/**
 * Sprint 3 shared contract (SPEC §6, §7.4–7.6): contacts, company insight,
 * applications, review screen state, send quota. Imported by the enrichment
 * pipeline (lib/hunter/prepare.ts…), the send pipeline (lib/hunter/send.ts,
 * lib/quotas.ts, lib/google/*) and the review UI (app/(app)/hunter/review).
 */

/** SPEC §7.6: 20 sends per user per rolling 24 h, enforced server side. */
export const SEND_LIMIT_PER_24H = 20;
/** SPEC §7.6: random spacing between two sends of the same user. */
export const SEND_SPACING_MIN_S = 30;
export const SEND_SPACING_MAX_S = 90;
/** A send claim older than this is considered abandoned (crashed worker). */
export const SEND_CLAIM_STALE_MS = 5 * 60_000;
/** Max leads queued for preparation in one click. */
export const MAX_PREPARE_AT_ONCE = 20;
/** A preparation "running" for longer than this is resumed. */
export const PREP_STALE_MS = 4 * 60_000;
/** SPEC §7.5: mail body length. */
export const BODY_MIN_WORDS = 90;
export const BODY_MAX_WORDS = 130;
export const SUBJECT_MAX_CHARS = 70;

export type ContactSource = "pattern_guess" | "generic" | "user_input" | "website";
export type ContactConfidence = "low" | "medium" | "high";

/** A possible recipient for a lead (row of `contacts` before insert). */
export type ContactCandidate = {
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string;
  source: ContactSource;
  confidence: ContactConfidence;
};

/** A stored contact. */
export type Contact = ContactCandidate & { id: string };

/** The single factual hook used by the mail (SPEC §7.4 step 3). */
export type CompanyInsight = {
  /** One French sentence, factual. */
  text: string;
  /** Source URL for kind "news"; null for kind "activity". */
  source_url: string | null;
  kind: "news" | "activity";
};

export type ApplicationStatus =
  "draft" | "approved" | "sent" | "replied" | "interview" | "rejected" | "no_reply" | "bounced";

export type PrepStatus = "queued" | "running" | "done" | "failed";

/** Company facts used by enrichment and composition. */
export type CompanyFacts = {
  id: string;
  siren: string;
  name: string;
  naf_label: string | null;
  city: string | null;
  headcount_label: string;
  /** Lower bound of the headcount range, null when unknown. */
  headcount_min: number | null;
  website: string | null;
  domain: string | null;
  leaders: { first_name: string; last_name: string; role: string }[];
};

/** Output of lib/hunter/compose.ts composeApplication(). */
export type ComposedMail = {
  subject: string;
  body: string;
  claims_used: string[];
  /** Claims not found in the profile after the single allowed regeneration. */
  claims_unverified: string[];
  /** Other quality problems left after regeneration (French, shown to the student). */
  warnings: string[];
  prompt_version: string;
};

export type GmailState = "not_configured" | "not_connected" | "active" | "expired" | "revoked";

export type GmailStatus = {
  state: GmailState;
  email: string | null;
  /** True when the connection lacks gmail.send (student unticked a box). */
  missingScopes: boolean;
};

export type SendQuota = {
  /** Sends logged over the last 24 h. */
  used: number;
  limit: number;
  /** Validated mails already waiting in the send queue. */
  queued: number;
  /** limit - used - queued, never negative. */
  remaining: number;
};

/** One mail on the review screen. */
export type ReviewItem = {
  applicationId: string;
  leadId: string;
  company: {
    name: string;
    city: string | null;
    activity: string | null;
    headcount_label: string;
    website: string | null;
  };
  contact: Contact | null;
  /** Every stored candidate for this lead (for "changer de contact"). */
  contacts: Contact[];
  subject: string;
  body: string;
  company_insight: string | null;
  company_insight_source: string | null;
  claims_unverified: string[];
  /** Remaining quality problems (French), e.g. word count out of range. */
  quality_warnings: string[];
  status: ApplicationStatus;
  approved_at: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  send_error: string | null;
  edited_by_user: boolean;
};

/** A lead still being prepared (or whose preparation failed). */
export type PreparingLead = {
  leadId: string;
  companyName: string;
  prep_status: PrepStatus;
  prep_error: string | null;
};

export type ReviewState = {
  items: ReviewItem[];
  preparing: PreparingLead[];
  quota: SendQuota;
  gmail: GmailStatus;
};
