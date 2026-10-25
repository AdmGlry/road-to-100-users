/**
 * Pure helpers of the review screen (SPEC §7.6). Client-safe: no server
 * imports. Unit-tested in tests/review-utils.test.ts.
 */
import {
  BODY_MAX_WORDS,
  BODY_MIN_WORDS,
  SEND_LIMIT_PER_24H,
  SEND_SPACING_MAX_S,
  SEND_SPACING_MIN_S,
  SUBJECT_MAX_CHARS,
  type Contact,
  type ContactConfidence,
  type ContactSource,
  type ReviewItem,
  type ReviewState,
  type SendQuota,
} from "@/lib/hunter/application-types";

/** Words = runs of non-space characters that contain a letter or a digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export type LengthState = "ok" | "short" | "long";

export function bodyLengthState(words: number): LengthState {
  if (words < BODY_MIN_WORDS) return "short";
  if (words > BODY_MAX_WORDS) return "long";
  return "ok";
}

/** "152 mots (conseillé : 120 à 180)" */
export function wordCountLabel(words: number): string {
  return `${words} mot${words > 1 ? "s" : ""} (conseillé : ${BODY_MIN_WORDS} à ${BODY_MAX_WORDS})`;
}

export function subjectTooLong(subject: string): boolean {
  return subject.trim().length > SUBJECT_MAX_CHARS;
}

export const CONFIDENCE_UI: Record<
  ContactConfidence,
  { label: string; variant: "success" | "warning" | "muted" }
> = {
  high: { label: "Fiable", variant: "success" },
  medium: { label: "Probable", variant: "warning" },
  low: { label: "À vérifier", variant: "muted" },
};

export const SOURCE_LABELS: Record<ContactSource, string> = {
  website: "Trouvée sur le site de l'entreprise",
  pattern_guess: "Devinée à partir du nom du dirigeant",
  generic: "Adresse générique de l'entreprise",
  user_input: "Saisie par toi",
};

/** "Prénom Nom" or null. */
export function contactName(contact: Pick<Contact, "first_name" | "last_name">): string | null {
  const name = [contact.first_name, contact.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}

/** Only http(s) URLs are ever rendered as links (no javascript:, data:…). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** "lemonde.fr" for display next to the source link. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Valid e-mail (light client check; the server validates with Zod). */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export type ItemPhase = "draft" | "error" | "approved" | "queued" | "sent";

export function itemPhase(
  item: Pick<ReviewItem, "status" | "scheduled_for" | "send_error">,
): ItemPhase {
  if (item.status === "draft") return item.send_error ? "error" : "draft";
  if (item.status === "approved") return item.scheduled_for ? "queued" : "approved";
  return "sent";
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/** "14:32" (French time, identical on the server render and in the browser). */
export function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : TIME_FORMAT.format(d);
}

/** Short status shown on each card. */
export function statusLabel(
  item: Pick<ReviewItem, "status" | "scheduled_for" | "send_error" | "sent_at">,
): string {
  const phase = itemPhase(item);
  switch (phase) {
    case "draft":
      return "À relire";
    case "error":
      return "Envoi échoué";
    case "approved":
      return "Validé";
    case "queued": {
      const at = formatTime(item.scheduled_for);
      return at ? `En file d'attente, envoi vers ${at}` : "En file d'attente";
    }
    case "sent": {
      if (item.status === "bounced") return "Adresse en erreur";
      const at = formatTime(item.sent_at);
      return at ? `Envoyé à ${at}` : "Envoyé";
    }
  }
}

/** "x envois restants sur 20 (24 h glissantes)" */
export function quotaLabel(quota: Pick<SendQuota, "remaining" | "limit">): string {
  const limit = quota.limit || SEND_LIMIT_PER_24H;
  const n = Math.max(0, quota.remaining);
  return `${n} envoi${n > 1 ? "s" : ""} restant${n > 1 ? "s" : ""} sur ${limit} (24 h glissantes)`;
}

/** Validated mails the student can send now (not queued yet, with a valid address). */
export function sendableItems(items: readonly ReviewItem[]): ReviewItem[] {
  return items.filter(
    (i) =>
      i.status === "approved" &&
      i.approved_at !== null &&
      i.scheduled_for === null &&
      i.contact !== null &&
      looksLikeEmail(i.contact.email),
  );
}

/** Rough duration of a batch: first mail now, then 30–90 s between two mails. */
export function sendDurationLabel(count: number): string {
  if (count <= 1) return "Il part dans la minute.";
  const minS = (count - 1) * SEND_SPACING_MIN_S;
  const maxS = (count - 1) * SEND_SPACING_MAX_S;
  const minM = Math.max(1, Math.round(minS / 60));
  const maxM = Math.max(minM, Math.round(maxS / 60));
  return minM === maxM
    ? `Compte environ ${minM} min pour l'ensemble.`
    : `Compte environ ${minM} à ${maxM} min pour l'ensemble.`;
}

/** "Envoyer les 3 mails validés" / "Envoyer le mail validé" */
export function sendButtonLabel(count: number): string {
  if (count === 1) return "Envoyer le mail validé";
  return `Envoyer les ${count} mails validés`;
}

export type ReviewCounts = {
  toReview: number;
  approved: number;
  queued: number;
  sent: number;
  errors: number;
};

export function countItems(items: readonly ReviewItem[]): ReviewCounts {
  const counts: ReviewCounts = { toReview: 0, approved: 0, queued: 0, sent: 0, errors: 0 };
  for (const item of items) {
    const phase = itemPhase(item);
    if (phase === "draft") counts.toReview += 1;
    else if (phase === "error") {
      counts.toReview += 1;
      counts.errors += 1;
    } else if (phase === "approved") counts.approved += 1;
    else if (phase === "queued") counts.queued += 1;
    else counts.sent += 1;
  }
  return counts;
}

/** "3 à relire, 2 validés, 1 envoyé" (empty parts omitted). */
export function countsSummary(c: ReviewCounts): string {
  const parts: string[] = [];
  if (c.toReview) parts.push(`${c.toReview} à relire`);
  if (c.approved) parts.push(`${c.approved} validé${c.approved > 1 ? "s" : ""}`);
  if (c.queued) parts.push(`${c.queued} en file d'attente`);
  if (c.sent) parts.push(`${c.sent} envoyé${c.sent > 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "Aucun mail pour le moment";
}

export function activePreparations(state: Pick<ReviewState, "preparing">): number {
  return state.preparing.filter((p) => p.prep_status === "queued" || p.prep_status === "running")
    .length;
}

/** Progress of the current preparation batch (ready mails vs still preparing). */
export function preparationProgress(state: Pick<ReviewState, "preparing" | "items">): {
  ready: number;
  total: number;
  percent: number;
} {
  const active = activePreparations(state);
  const ready = state.items.filter((i) => i.status === "draft" || i.status === "approved").length;
  const total = ready + active;
  return { ready, total, percent: total === 0 ? 100 : Math.round((ready / total) * 100) };
}

export const PREPARE_POLL_MS = 5_000;
export const QUEUE_POLL_MS = 20_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * What the open page has to poll: the preparation (every 5 s) while leads
 * are being prepared, else the send queue (every 20 s) while mails are
 * queued, else nothing. Errors back off exponentially.
 */
export function pollPlan(
  state: Pick<ReviewState, "preparing" | "items">,
  consecutiveErrors = 0,
): { kind: "prepare" | "queue"; delay: number } | null {
  const backoff = (base: number) =>
    Math.min(MAX_BACKOFF_MS, base * 2 ** Math.max(0, Math.min(consecutiveErrors, 6)));
  if (activePreparations(state) > 0) return { kind: "prepare", delay: backoff(PREPARE_POLL_MS) };
  if (state.items.some((i) => i.status === "approved" && i.scheduled_for !== null)) {
    return { kind: "queue", delay: Math.max(QUEUE_POLL_MS, backoff(QUEUE_POLL_MS)) };
  }
  return null;
}
