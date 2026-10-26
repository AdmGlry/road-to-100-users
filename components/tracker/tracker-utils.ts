/**
 * Pure helpers of the tracker board (SPEC §8.4). Client-safe: no server
 * imports. Unit-tested in tests/tracker-utils.test.ts.
 */
import {
  CLASSIFICATION_LABELS,
  FOLLOWUP_MAX_WORDS,
  FOLLOWUP_MIN_WORDS,
  TRACKER_COLUMNS,
  type ReplyClassification,
  type TrackerCard,
  type TrackerColumn,
  type TrackerReply,
} from "@/lib/tracker/types";

export { countWords } from "@/components/review/review-utils";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Paris",
});
const FULL_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * "à l'instant", "il y a 12 min", "il y a 3 h", "hier", "il y a 5 jours",
 * then "le 3 oct." (French, Paris time). `now` comes from the server render
 * so the server and the browser print the same text.
 */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return "à l'instant";
  if (diff < HOUR) return `il y a ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `il y a ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  const sameYear = new Date(t).getUTCFullYear() === new Date(now).getUTCFullYear();
  return `le ${(sameYear ? DAY_FORMAT : DAY_YEAR_FORMAT).format(new Date(t))}`;
}

/** "26 octobre 2026 à 14:32" (for the `title` / detail). */
export function fullDate(iso: string | null | undefined): string | null {
  const t = parse(iso);
  return t === null ? null : FULL_FORMAT.format(new Date(t));
}

export function lastSyncLabel(lastSyncAt: string | null, now: number): string {
  const rel = relativeTime(lastSyncAt, now);
  return rel ? `Dernière synchronisation : ${rel}` : "Pas encore synchronisé";
}

/** "34 %" (0 when nothing sent). */
export function percentLabel(rate: number): string {
  const pct = Number.isFinite(rate) ? Math.round(Math.min(1, Math.max(0, rate)) * 100) : 0;
  return `${pct} %`;
}

export type BadgeTone = "success" | "warning" | "danger" | "muted" | "info";

export const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  info: "bg-secondary text-secondary-foreground",
};

export const CLASSIFICATION_TONES: Record<ReplyClassification, BadgeTone> = {
  interview: "success",
  positive_other: "success",
  info_request: "warning",
  rejection: "danger",
  bounce: "danger",
  auto_reply: "muted",
  other: "info",
};

export function classificationLabel(c: ReplyClassification | null): string {
  return c ? CLASSIFICATION_LABELS[c] : "Réponse à classer";
}

export function classificationTone(c: ReplyClassification | null): BadgeTone {
  return c ? CLASSIFICATION_TONES[c] : "info";
}

/** The newest reply (replies are stored newest first). */
export function latestReply(card: Pick<TrackerCard, "replies">): TrackerReply | null {
  return card.replies[0] ?? null;
}

export function columnLabel(column: TrackerColumn): string {
  return TRACKER_COLUMNS.find((c) => c.id === column)?.label ?? column;
}

export function cardsByColumn(cards: readonly TrackerCard[]): Record<TrackerColumn, TrackerCard[]> {
  const out = Object.fromEntries(TRACKER_COLUMNS.map((c) => [c.id, [] as TrackerCard[]])) as Record<
    TrackerColumn,
    TrackerCard[]
  >;
  for (const card of cards) (out[card.column] ?? out.sent).push(card);
  return out;
}

export type FollowupLength = "ok" | "short" | "long";

export function followupLengthState(words: number): FollowupLength {
  if (words < FOLLOWUP_MIN_WORDS) return "short";
  if (words > FOLLOWUP_MAX_WORDS) return "long";
  return "ok";
}

export function followupWordsLabel(words: number): string {
  return `${words} mot${words > 1 ? "s" : ""} (conseillé : ${FOLLOWUP_MIN_WORDS} à ${FOLLOWUP_MAX_WORDS})`;
}

export function syncAnnouncement(newReplies: number): string {
  if (newReplies <= 0) return "Synchronisation terminée : aucune nouvelle réponse.";
  return newReplies > 1
    ? `Synchronisation terminée : ${newReplies} nouvelles réponses.`
    : "Synchronisation terminée : 1 nouvelle réponse.";
}
