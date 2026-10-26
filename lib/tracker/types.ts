/**
 * Sprint 4 contract — module Suivi (SPEC §8, §9). Shared types and constants
 * of the reply sync, the follow-ups and the board. Client-safe (no I/O).
 *
 * Modules (SERVER ONLY unless noted):
 * - lib/tracker/classify.ts  classifyReply(), statusForClassification(), cleanReplyText()
 * - lib/tracker/sync.ts      syncReplies() — cron `sync-replies` + "Synchroniser maintenant"
 * - lib/tracker/notify.ts    notifyInterview() — mail to the student's own address
 * - lib/tracker/followups.ts generateFollowups(), markNoReply(), updateFollowup(),
 *                            sendFollowup(), dismissFollowup() — cron `followups` + board
 * - lib/tracker/board.ts     loadTrackerState(), moveCard(), reviseBounced()
 *
 * Rules shared by every module:
 * - only the app's own threads are read (`applications.gmail_thread_id`, SPEC §6.2);
 * - reply contents are never stored beyond a 200-char snippet, never logged;
 * - nothing is sent without an explicit validation (follow-ups included);
 * - tracker mutations run on the service-role client, always filtered on the
 *   session user id (the `applications_guard_client_write` trigger makes sent
 *   applications read-only for clients).
 */
import type { ApplicationStatus, GmailStatus } from "@/lib/hunter/application-types";

export type ReplyClassification =
  "interview" | "rejection" | "info_request" | "positive_other" | "auto_reply" | "bounce" | "other";

export const REPLY_CLASSIFICATIONS: readonly ReplyClassification[] = [
  "interview",
  "rejection",
  "info_request",
  "positive_other",
  "auto_reply",
  "bounce",
  "other",
];

/** French labels shown on the board. */
export const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  interview: "Entretien proposé",
  rejection: "Refus",
  info_request: "Demande d'informations",
  positive_other: "Réponse positive",
  auto_reply: "Réponse automatique",
  bounce: "Adresse invalide",
  other: "Réponse",
};

/** Statuses of a mail that has left (the board only shows these). */
export type SentStatus = Extract<
  ApplicationStatus,
  "sent" | "replied" | "interview" | "rejected" | "no_reply" | "bounced"
>;

export const SENT_STATUSES: readonly SentStatus[] = [
  "sent",
  "replied",
  "interview",
  "rejected",
  "no_reply",
  "bounced",
];

/** Kanban columns (SPEC §8.4). `bounced` cards live in "sent" with an alert. */
export type TrackerColumn = "sent" | "replied" | "interview" | "rejected" | "no_reply";

export const TRACKER_COLUMNS: readonly { id: TrackerColumn; label: string }[] = [
  { id: "sent", label: "Envoyé" },
  { id: "replied", label: "Réponse reçue" },
  { id: "interview", label: "Entretien" },
  { id: "rejected", label: "Refus" },
  { id: "no_reply", label: "Sans réponse" },
];

export type FollowupStatus = "draft" | "sending" | "sent" | "dismissed";

/** Threads of mails sent in the last N days are synced (SPEC §8.1). */
export const SYNC_WINDOW_DAYS = 60;
/** A follow-up is proposed N days after the send without reply (SPEC §8.3). */
export const FOLLOWUP_AFTER_DAYS = 7;
/** Status `no_reply` N days after the send, without reply, once followed up. */
export const NO_REPLY_AFTER_DAYS = 21;
export const FOLLOWUP_MIN_WORDS = 50;
export const FOLLOWUP_MAX_WORDS = 80;
/** Max characters of a stored reply snippet (DB check). */
export const SNIPPET_MAX_CHARS = 200;
/** Max characters of reply text sent to the classifier (SPEC §8.2). */
export const REPLY_TEXT_MAX_CHARS = 1000;
/** "Synchroniser maintenant" at most once every N minutes per student. */
export const MANUAL_SYNC_COOLDOWN_MIN = 5;

export type ClassifiedReply = {
  classification: ReplyClassification;
  /** 0–1. */
  confidence: number;
  /** One French sentence for the student. */
  suggested_action: string;
  /** "rule" = deterministic pre-check (bounce / auto-reply headers), "llm" = prompt classify_reply. */
  source: "rule" | "llm";
};

export type TrackerReply = {
  id: string;
  received_at: string;
  from_email: string | null;
  snippet: string | null;
  classification: ReplyClassification | null;
  suggested_action: string | null;
};

export type TrackerFollowup = {
  status: FollowupStatus;
  subject: string;
  body: string;
  approved_at: string | null;
  sent_at: string | null;
  error: string | null;
};

export type TrackerCard = {
  applicationId: string;
  company: { name: string; city: string | null };
  contact: { name: string | null; email: string } | null;
  subject: string;
  body: string;
  status: SentStatus;
  column: TrackerColumn;
  sent_at: string | null;
  last_reply_at: string | null;
  /** https://mail.google.com/mail/u/0/#all/<thread id>, null when unknown. */
  gmailUrl: string | null;
  /** Newest first. */
  replies: TrackerReply[];
  followup: TrackerFollowup | null;
  status_set_manually: boolean;
};

export type TrackerStats = {
  sent: number;
  /** Applications with at least one non-automatic reply. */
  replied: number;
  /** replied / sent, 0 when nothing sent. */
  replyRate: number;
  interviews: number;
  /** Follow-up drafts waiting for the student's validation. */
  pendingFollowups: number;
};

export type TrackerState = {
  cards: TrackerCard[];
  stats: TrackerStats;
  gmail: GmailStatus;
  lastSyncAt: string | null;
};
