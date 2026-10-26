/**
 * Removes personal contact data from text sent to an LLM (GDPR minimisation):
 * e-mail addresses, French phone numbers and links, plus the <<< >>> delimiter
 * look-alikes used by the prompts.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+33\s?|0033\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;

export function scrubPersonalData(v: string): string {
  return v
    .replace(/<{3,}|>{3,}/g, " ")
    .replace(EMAIL_RE, " ")
    .replace(URL_RE, " ")
    .replace(PHONE_RE, " ");
}
