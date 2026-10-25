/**
 * Automatic quality / grounding checks of a generated application mail
 * (SPEC §7.5: "un contrôle automatique vérifie que chaque élément existe bien
 * dans le profil"). Pure, no I/O.
 *
 * Claim heuristic (checkClaims):
 *   1. The profile corpus = every user-editable profile field (name, school,
 *      degree, skills, experiences with bullets, education, languages, pitch,
 *      preferences, start date also written in French: "septembre 2027"…),
 *      normalised (lower case, no accents, punctuation → spaces).
 *   2. A claim's significant tokens = words of ≥ 3 letters that are not
 *      stopwords nor "meta" words that only describe the claim ("expérience",
 *      "compétence", "maîtrise", "stage chez"…), plus every number.
 *   3. Verified when EVERY number of the claim is in the profile and at least
 *      80 % of its significant words are (a plural "s"/"x" is ignored), or —
 *      for claims made only of short tokens ("C", "R", "UX") — when the whole
 *      claim appears as a phrase. A claim with no usable token is unverified.
 *   Deliberately strict on numbers (invented figures are the worst case) and
 *   tolerant on wording (the model paraphrases).
 */
import type { ComposedMail } from "@/lib/hunter/application-types";
import { BODY_MAX_WORDS, BODY_MIN_WORDS, SUBJECT_MAX_CHARS } from "@/lib/hunter/application-types";
import { normalizeForMatch } from "@/lib/profile/grounding";
import type { EditableProfile } from "@/lib/profile/schema";

const STOPWORDS = new Set(
  (
    "and aux avec ces cet cette dans des du est for les leur leurs par pour sous sur the une via " +
    "mon mes ma son ses sa nos notre vos votre chez dont qui que quoi aussi plus tres bien " +
    "ete etre avoir ans annee annees mois lors entre apres avant depuis pendant durant ainsi " +
    "comme tout tous toute toutes cela ceci ont fait faire realise realisee mene menee"
  ).split(" "),
);

/** Words that describe a claim without being evidence ("Expérience : stage chez X"). */
const META_WORDS = new Set(
  (
    "experience experiences competence competences maitrise maitrises connaissance connaissances " +
    "niveau capacite capacites aptitude aptitudes savoir utilisation usage pratique outil outils " +
    "profil formation actuelle actuel actuellement poste mission missions projet projets " +
    "etudiant etudiante cours cursus diplome obtenu obtenue preparation prepare prepares " +
    "contrat recherche recherchee souhaite rythme debut disponible disponibilite"
  ).split(" "),
);

const FRENCH_MONTHS = [
  "janvier",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
];
const SHORT_MONTHS = [
  "janv",
  "fevr",
  "mars",
  "avr",
  "mai",
  "juin",
  "juil",
  "aout",
  "sept",
  "oct",
  "nov",
  "dec",
];

const COVERAGE_MIN = 0.8;

/** All profile values the mail may legitimately use, normalised for matching. */
export function buildProfileCorpus(profile: EditableProfile): string {
  const parts: (string | null | undefined)[] = [
    profile.full_name,
    // Phone digits only as one compact token: "06 12 34…" must not make "12" a known figure.
    profile.phone ? nationalDigits(profile.phone) : null,
    profile.city,
    profile.school,
    profile.degree,
    profile.pitch,
    profile.contract_type,
    profile.rhythm,
    ...profile.skills,
    ...profile.target_roles,
    ...profile.target_sectors,
  ];
  for (const e of profile.experiences) parts.push(e.title, e.company, e.start, e.end, ...e.bullets);
  for (const e of profile.education) parts.push(e.degree, e.school, e.start, e.end);
  for (const l of profile.languages) parts.push(l.language, l.level);
  const m = /^(\d{4})-(\d{2})/.exec(profile.start_date ?? "");
  if (m) {
    const month = Number(m[2]) - 1;
    if (month >= 0 && month < 12) {
      parts.push(
        `${FRENCH_MONTHS[month]} ${m[1]}`,
        `${SHORT_MONTHS[month]} ${m[1]}`,
        `${m[2]}/${m[1]}`,
      );
    }
  }
  return normalizeForMatch(parts.filter((p): p is string => !!p && p.trim() !== "").join(" \n "));
}

const singular = (t: string) => (t.length > 3 ? t.replace(/[sx]$/, "") : t);

function claimTokens(claim: string): { words: string[]; numbers: string[] } {
  const tokens = normalizeForMatch(claim).split(" ").filter(Boolean);
  return {
    numbers: tokens.filter((t) => /\d/.test(t)),
    words: tokens.filter(
      (t) => !/\d/.test(t) && t.length >= 3 && !STOPWORDS.has(t) && !META_WORDS.has(t),
    ),
  };
}

class Corpus {
  readonly padded: string;
  readonly words: Set<string>;
  constructor(normalized: string) {
    this.padded = ` ${normalized.replace(/\s+/g, " ")} `;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    this.words = new Set([...tokens, ...tokens.map(singular)]);
  }
  hasWord(t: string) {
    return this.words.has(t) || this.words.has(singular(t));
  }
  hasNumber(n: string) {
    return this.padded.includes(` ${n} `) || this.words.has(n);
  }
  hasPhrase(p: string) {
    return p.length > 0 && this.padded.includes(` ${p} `);
  }
}

function isClaimGrounded(claim: string, corpus: Corpus): boolean {
  const { words, numbers } = claimTokens(claim);
  if (!numbers.every((n) => corpus.hasNumber(n))) return false;
  if (words.length === 0) {
    if (numbers.length > 0) return true;
    return corpus.hasPhrase(normalizeForMatch(claim));
  }
  const hits = words.filter((w) => corpus.hasWord(w)).length;
  return hits / words.length >= COVERAGE_MIN;
}

export function checkClaims(
  claims: readonly string[],
  profile: EditableProfile,
): { verified: string[]; unverified: string[] } {
  const corpus = new Corpus(buildProfileCorpus(profile));
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const raw of claims) {
    const claim = raw.trim();
    if (!claim) continue;
    (isClaimGrounded(claim, corpus) ? verified : unverified).push(claim);
  }
  return { verified, unverified };
}

/** Words = whitespace-separated chunks containing a letter or a digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const BANNED: [RegExp, string][] = [
  [/\bdynamiques?\b/, "dynamique"],
  [/\bmotive(?:e|s|es)?\b/, "motivé"],
  [/\bmotivation\b/, "motivation"],
  [/\brigoureu(?:x|se|ses)\b/, "rigoureux"],
];

/** Hollow words forbidden by SPEC §7.5 (base form, unique). */
export function findBannedWords(text: string): string[] {
  const t = normalizeForMatch(text);
  return BANNED.filter(([re]) => re.test(t)).map(([, w]) => w);
}

const PHONE_RE = /(?:\+33\s?|0033\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g;

/** "+33 6 12 34 56 78" / "06.12.34.56.78" → "0612345678". */
function nationalDigits(phone: string): string {
  const d = phone.replace(/\D+/g, "");
  if (d.startsWith("0033")) return `0${d.slice(4)}`;
  if (d.startsWith("33") && d.length === 11) return `0${d.slice(2)}`;
  return d;
}

/** Numbers always allowed in a mail ("échange de 15 minutes"). */
const ALLOWED_NUMBERS = new Set(["15"]);

export type MailProblem =
  | { code: "claims_unverified"; message: string; claims: string[] }
  | { code: "claims_missing"; message: string }
  | { code: "word_count"; message: string; words: number }
  | { code: "subject_length"; message: string }
  | { code: "subject_empty"; message: string }
  | { code: "banned_words"; message: string; words: string[] }
  | { code: "unknown_numbers"; message: string; numbers: string[] };

export type MailToCheck = Pick<ComposedMail, "subject" | "body" | "claims_used">;

/**
 * Structured problems of a mail. `allowedText` = other facts the mail may quote
 * (company name, city, activity, insight): numbers found there are accepted.
 */
export function analyzeMail(
  mail: MailToCheck,
  profile: EditableProfile,
  context: { allowedText?: string } = {},
): MailProblem[] {
  const problems: MailProblem[] = [];
  const { unverified } = checkClaims(mail.claims_used, profile);
  if (unverified.length > 0) {
    problems.push({
      code: "claims_unverified",
      message: `Éléments introuvables dans ton profil : ${unverified.join(" ; ")}.`,
      claims: unverified,
    });
  }
  if (mail.claims_used.filter((c) => c.trim()).length === 0) {
    problems.push({
      code: "claims_missing",
      message: "Le mail ne s'appuie sur aucun élément concret de ton profil.",
    });
  }
  const words = countWords(mail.body);
  if (words < BODY_MIN_WORDS || words > BODY_MAX_WORDS) {
    problems.push({
      code: "word_count",
      message: `Le mail fait ${words} mots (attendu : ${BODY_MIN_WORDS} à ${BODY_MAX_WORDS}).`,
      words,
    });
  }
  const subject = mail.subject.trim();
  if (!subject) {
    problems.push({ code: "subject_empty", message: "L'objet est vide." });
  } else if ([...subject].length > SUBJECT_MAX_CHARS) {
    problems.push({
      code: "subject_length",
      message: `L'objet dépasse ${SUBJECT_MAX_CHARS} caractères.`,
    });
  }
  const banned = findBannedWords(`${mail.subject}\n${mail.body}`);
  if (banned.length > 0) {
    problems.push({
      code: "banned_words",
      message: `Formules creuses à éviter : ${banned.join(", ")}.`,
      words: banned,
    });
  }
  const corpus = new Corpus(
    `${buildProfileCorpus(profile)} ${normalizeForMatch(context.allowedText ?? "")}`,
  );
  // Phone numbers: accepted only when they are the student's own phone.
  const ownPhone = profile.phone ? nationalDigits(profile.phone) : null;
  const unknownPhones: string[] = [];
  const withoutPhones = `${mail.subject} ${mail.body}`.replace(PHONE_RE, (m) => {
    const digits = nationalDigits(m);
    if (digits !== ownPhone) unknownPhones.push(digits);
    return " ";
  });
  const numbers = [
    ...unknownPhones,
    ...new Set(normalizeForMatch(withoutPhones).match(/\d+/g) ?? []),
  ].filter((n) => !ALLOWED_NUMBERS.has(n) && !corpus.hasNumber(n));
  if (numbers.length > 0) {
    problems.push({
      code: "unknown_numbers",
      message: `Chiffres absents de ton profil : ${numbers.join(", ")}.`,
      numbers,
    });
  }
  return problems;
}

/** French problem messages (empty = mail OK). */
export function checkMail(
  mail: MailToCheck,
  profile: EditableProfile,
  context: { allowedText?: string } = {},
): string[] {
  return analyzeMail(mail, profile, context).map((p) => p.message);
}
