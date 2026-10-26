/**
 * Reply classification (SPEC §8.2). SERVER ONLY (classifyReply calls the LLM;
 * the other helpers are pure).
 *
 * 1. cleanReplyText: strips quoted history and signature, 2000 chars max;
 * 2. ruleClassify: deterministic pre-check (bounces, auto-replies from
 *    headers and well-known subjects) — no LLM call for those;
 * 3. classifyReply: rule first, else prompt `classify_reply` (fast tier).
 *    An LLM failure never throws: the reply is stored as "other" with a
 *    neutral action so the sync goes on.
 * statusForClassification maps a category to the next application status
 * without ever downgrading an interview or a rejection.
 * Never logs reply contents: only error names.
 */
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildClassifyReplyPrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
} from "@/lib/llm/prompts/classify-reply";
import {
  REPLY_TEXT_MAX_CHARS,
  type ClassifiedReply,
  type ReplyClassification,
  type SentStatus,
} from "@/lib/tracker/types";

export { PROMPT_VERSION as CLASSIFY_PROMPT_VERSION };

export const SUGGESTED_ACTIONS = {
  bounce:
    "Cette adresse ne fonctionne pas : choisis un autre contact dans cette entreprise et renvoie ta candidature.",
  auto_reply:
    "C'est une réponse automatique : rien à faire pour l'instant, attends la vraie réponse.",
  fallback: "Lis cette réponse dans ton Gmail.",
  delayed:
    "Ton mail n'est pas encore arrivé, le serveur du destinataire réessaie : attends quelques jours avant de changer de contact.",
  blocked:
    "Ton mail a été bloqué par un filtre anti-spam : ne renvoie pas le même texte tout de suite, personnalise-le d'abord.",
  left_company:
    "Cette personne a quitté l'entreprise : choisis un autre contact et renvoie ta candidature.",
  rejection: "C'est un refus : inutile de relancer, concentre-toi sur tes autres candidatures.",
  opt_out:
    "Ce recruteur ne souhaite plus être contacté : ne le relance pas et ne lui écris plus depuis Spontané.",
} as const;

/** "Ne plus me contacter" / "supprimez mes données" (GDPR objection, art. 21). */
const OPT_OUT_RE =
  /\b(ne (plus|pas) (me|nous) (contacter|recontacter|écrire|solliciter)|(supprim|effac)\w* (mes|nos) (données|coordonnées)|désinscri\w*|unsubscribe|stop)\b/i;

// ---------------------------------------------------------------------------
// Text cleaning

/** Lines that start the quoted history of a reply (everything after is dropped). */
const HISTORY_MARKERS: RegExp[] = [
  /^le\s.+\s(a\s+)?écrit\s*:?\s*$/i,
  /^on\s.+\swrote\s*:?\s*$/i,
  /^-{2,}\s*(original message|message d'origine|message original|forwarded message|message transféré)\s*-{2,}/i,
  /^_{10,}\s*$/,
];

const HEADER_FROM = /^\*?(de|from)\s*:\s*\S/i;
const HEADER_SENT = /^\*?(envoyé|sent|date)\s*:\s*\S/i;

/** Index of the first line of the quoted history, or -1. */
function historyStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (HISTORY_MARKERS.some((re) => re.test(line))) return i;
    // Gmail wraps long attributions: "Le lun. 26 oct. …, Léa <lea@x.fr> a" / "écrit :".
    if (/^(le|on)\s/i.test(line) && i + 1 < lines.length) {
      const joined = `${line} ${lines[i + 1].trim()}`;
      if (HISTORY_MARKERS.slice(0, 2).some((re) => re.test(joined))) return i;
    }
    // Outlook: "De : …" followed by "Envoyé : …" within the next lines.
    if (HEADER_FROM.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (HEADER_SENT.test(lines[j].trim())) return i;
      }
    }
  }
  return -1;
}

/**
 * Text of the reply itself: quoted history (`>` lines, "Le … a écrit :",
 * "On … wrote:", "-----Original Message-----", Outlook "De : … Envoyé : …"
 * blocks) and signature (after "-- ") removed, whitespace collapsed,
 * REPLY_TEXT_MAX_CHARS characters max.
 */
const SIGN_OFF_RE =
  /^(bien |très )?(cordialement|sincèrement|amicalement|salutations( distinguées)?|bien à (vous|toi)|bonne (journée|soirée|fin de journée)|belle journée|à bientôt|(best|kind)? ?regards|best)[\s,.!]*$/i;

export function cleanReplyText(text: string): string {
  let lines = (text ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ").split("\n");

  const start = historyStart(lines);
  if (start >= 0) lines = lines.slice(0, start);

  // Signature: "-- " line, or the usual sign-off (name, title, phone follow it).
  const signature = lines.findIndex((l) => /^--\s*$/.test(l) || SIGN_OFF_RE.test(l.trim()));
  if (signature >= 0) lines = lines.slice(0, signature);

  const cleaned = lines
    .filter((l) => !/^\s*>/.test(l))
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.slice(0, REPLY_TEXT_MAX_CHARS).trim();
}

/** `"Jean Dupont" <Jean@Acme.fr>` → `jean@acme.fr`. Empty string when none. */
export function extractEmailAddress(from: string): string {
  const raw = from ?? "";
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  if (bracketed) return bracketed[1].trim().toLowerCase();
  const bare = /[^\s<>"(),;:]+@[^\s<>"(),;:]+/.exec(raw);
  return bare ? bare[0].trim().toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// Deterministic pre-check

export type ReplyInput = {
  /** Raw `From` header. */
  from: string;
  subject: string;
  /** Lower-cased header names: auto-submitted, x-autoreply, x-autorespond, precedence. */
  autoHeaders: Record<string, string>;
  /** Cleaned text (cleanReplyText). */
  text: string;
};

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECTS =
  /delivery status notification|undeliverable|undelivered mail|mail delivery (failed|failure|subsystem)|delivery (has )?failed|delivery failure|returned mail|failure notice|non remis|non distribu|adresse introuvable|échec de (la )?(remise|livraison|distribution)|message bloqué|address not found/i;
const BOUNCE_TEXT =
  /adresse introuvable|address not found|user unknown|mailbox (unavailable|not found)|n'a pas pu être (remis|distribué)|wasn't delivered|could not be delivered/i;

const AUTO_SUBJECTS_ANYWHERE =
  /réponse automatique|reponse automatique|automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|accusé de réception|accuse de reception|message automatique/i;
const AUTO_SUBJECTS_PREFIX = /^\s*(?:(?:re|tr|fw|fwd|aw)\s*:\s*)*(absence|absent|absente)\b/i;

const isBounce = (input: ReplyInput, address: string) =>
  BOUNCE_SENDER.test(address) ||
  BOUNCE_SUBJECTS.test(input.subject ?? "") ||
  (/^(mailer|postmaster|mail delivery)/i.test(input.from ?? "") && BOUNCE_TEXT.test(input.text));

function hasAutoHeaders(headers: Record<string, string>): boolean {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) h[k.toLowerCase()] = String(v);
  const autoSubmitted = h["auto-submitted"];
  if (autoSubmitted !== undefined && autoSubmitted.trim().toLowerCase() !== "no") return true;
  if (h["x-autoreply"] !== undefined || h["x-autorespond"] !== undefined) return true;
  const precedence = h["precedence"]?.trim().toLowerCase();
  return precedence === "auto_reply" || precedence === "bulk" || precedence === "junk";
}

/** Delivery delayed / mailbox full: the server keeps retrying, the address may be fine. */
const DSN_SOFT =
  /\(delay\)|delayed|retrying|will (retry|continue)|nouvelle tentative|remise différée|\b4\.\d{1,3}\.\d{1,3}\b|mailbox (is )?full|boîte (aux lettres )?pleine|quota (exceeded|dépassé)/i;
/** Refused by an anti-spam or policy filter: changing the address would not help. */
const DSN_BLOCKED = /\b5\.7\.\d{1,3}\b|spam|blocked|bloqué|policy|blacklist|liste noire/i;
/** Auto-reply saying the person left: the address is unusable. */
const LEFT_COMPANY =
  /(a|ont) quitté (l'entreprise|la société|nos effectifs|le groupe)|ne fait plus partie|n'est plus (en poste|joignable|consultée|utilisée|active)|no longer (with|works|employed|in use|monitored|active)|has left the company/i;
/** Refusal sent by a recruitment tool (carries auto-reply headers). */
const AUTOMATED_REJECTION =
  /ne (pas )?(pourrons|pouvons) (pas )?donner (une )?suite|ne donnerons pas (de )?suite|pas (de )?suite favorable|candidature n'a pas été retenue|pas été retenue|regret to inform|not (be )?moving forward/i;

const rule = (
  classification: ClassifiedReply["classification"],
  suggested_action: string,
): ClassifiedReply => ({ classification, confidence: 1, suggested_action, source: "rule" });

/** Bounce, auto-reply or opt-out recognised without the LLM; null when the LLM must decide. */
export function ruleClassify(input: ReplyInput): ClassifiedReply | null {
  const address = extractEmailAddress(input.from);
  const subject = input.subject ?? "";
  const text = input.text ?? "";
  if (isBounce(input, address)) {
    const report = `${subject}\n${text}`;
    if (DSN_SOFT.test(report)) return rule("auto_reply", SUGGESTED_ACTIONS.delayed);
    if (DSN_BLOCKED.test(report)) return rule("auto_reply", SUGGESTED_ACTIONS.blocked);
    return rule("bounce", SUGGESTED_ACTIONS.bounce);
  }
  if (
    hasAutoHeaders(input.autoHeaders) ||
    AUTO_SUBJECTS_ANYWHERE.test(subject) ||
    AUTO_SUBJECTS_PREFIX.test(subject)
  ) {
    if (LEFT_COMPANY.test(text)) return rule("bounce", SUGGESTED_ACTIONS.left_company);
    if (AUTOMATED_REJECTION.test(text)) return rule("rejection", SUGGESTED_ACTIONS.rejection);
    return rule("auto_reply", SUGGESTED_ACTIONS.auto_reply);
  }
  if (OPT_OUT_RE.test(text)) return rule("rejection", SUGGESTED_ACTIONS.opt_out);
  return null;
}

// ---------------------------------------------------------------------------
// Classification

export type ClassifyDeps = {
  provider?: LlmProvider;
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
};

/** Rule pre-check, then the LLM. Never throws. */
export async function classifyReply(
  input: ReplyInput,
  deps: ClassifyDeps = {},
): Promise<ClassifiedReply> {
  const rule = ruleClassify(input);
  if (rule) return rule;

  try {
    const { system, prompt } = buildClassifyReplyPrompt({
      text: input.text,
      subject: input.subject,
    });
    const { data } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: deps.provider,
      onUsage: deps.onUsage,
    });
    return {
      classification: data.category,
      confidence: data.confidence,
      suggested_action: data.suggested_action,
      source: "llm",
    };
  } catch (err) {
    console.error("[tracker] classify failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return {
      classification: "other",
      confidence: 0,
      suggested_action: SUGGESTED_ACTIONS.fallback,
      source: "llm",
    };
  }
}

// ---------------------------------------------------------------------------
// Status update

const TARGET_STATUS: Record<ReplyClassification, SentStatus | null> = {
  interview: "interview",
  rejection: "rejected",
  bounce: "bounced",
  auto_reply: null,
  info_request: "replied",
  positive_other: "replied",
  other: "replied",
};

/**
 * Next status of an application after a reply (SPEC §8.2), null when it does
 * not change. Never downgrades: an interview only moves to rejected, a
 * rejection only to interview; a bounce only applies before any real reply.
 */
export function statusForClassification(
  current: SentStatus,
  classification: ReplyClassification,
): SentStatus | null {
  const target = TARGET_STATUS[classification];
  if (!target || target === current) return null;
  if (current === "interview" && target !== "rejected") return null;
  if (current === "rejected" && target !== "interview") return null;
  if (target === "bounced" && current === "replied") return null;
  return target;
}
