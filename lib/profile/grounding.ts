/**
 * Deterministic anti-hallucination guard for `extract_profile` (SPEC §5:
 * "Aucun champ n'est inventé").
 *
 * Every extracted value must be supported by the CV text; values that are not
 * are nulled (scalar fields) or dropped (list items). `removed` lists the
 * paths that were changed (e.g. "skills[2]", "experiences[0].company") so the
 * caller can log COUNTS — never log the values themselves.
 */
import type { Education, Experience, ExtractedProfile, Language } from "./schema";

/** Short or very common words that carry no evidence on their own. */
const STOPWORDS = new Set([
  "and",
  "aux",
  "avec",
  "ces",
  "dans",
  "des",
  "du",
  "est",
  "for",
  "les",
  "leur",
  "leurs",
  "par",
  "pour",
  "sous",
  "sur",
  "the",
  "une",
  "via",
]);

const BULLET_MIN_RATIO = 0.6;

/** Lowercase, strip accents, punctuation → spaces, collapse whitespace. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/** Pre-computed views of the CV text used by every check. */
class CvIndex {
  readonly normalized: string;
  readonly padded: string;
  readonly tokens: Set<string>;
  readonly numbers: Set<string>;
  readonly lower: string;
  readonly lowerCompact: string;
  readonly digits: string;

  constructor(cvText: string) {
    this.normalized = normalizeForMatch(cvText);
    this.padded = ` ${this.normalized} `;
    this.tokens = new Set(this.normalized.split(" ").filter(Boolean));
    this.numbers = new Set(cvText.match(/\d+/g) ?? []);
    this.lower = cvText.toLowerCase();
    this.lowerCompact = this.lower.replace(/\s+/g, "");
    this.digits = digitsOnly(cvText);
  }

  hasPhrase(normalizedPhrase: string): boolean {
    return normalizedPhrase.length > 0 && this.padded.includes(` ${normalizedPhrase} `);
  }
}

/** Significant tokens: words of ≥3 characters (minus stopwords) and every number. */
function significantTokens(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((t) => t.length > 0 && (/^\d+$/.test(t) || (t.length >= 3 && !STOPWORDS.has(t))));
}

/** Ratio of the value's significant tokens found in the CV (null = no significant token). */
function tokenCoverage(value: string, cv: CvIndex): number | null {
  const tokens = significantTokens(value);
  if (tokens.length === 0) return null;
  return tokens.filter((t) => cv.tokens.has(t)).length / tokens.length;
}

/**
 * A text value is grounded when every significant token appears in the CV, or,
 * for values made only of short tokens ("C", "R", "UX", "B2"), when the whole
 * normalised value appears as a phrase.
 */
function isGroundedText(value: string, cv: CvIndex): boolean {
  const coverage = tokenCoverage(value, cv);
  if (coverage === null) return cv.hasPhrase(normalizeForMatch(value));
  return coverage === 1;
}

function isGroundedBullet(value: string, cv: CvIndex): boolean {
  const coverage = tokenCoverage(value, cv);
  if (coverage === null) return cv.hasPhrase(normalizeForMatch(value));
  return coverage >= BULLET_MIN_RATIO;
}

/** Dates: every number must appear in the CV; dates without digits ("aujourd'hui") are text-checked. */
function isGroundedDate(value: string, cv: CvIndex): boolean {
  const numbers = value.match(/\d+/g);
  if (!numbers) return isGroundedText(value, cv);
  return numbers.every((n) => cv.numbers.has(n));
}

function isGroundedEmail(value: string, cv: CvIndex): boolean {
  const email = value.trim().toLowerCase();
  return email.length > 0 && (cv.lower.includes(email) || cv.lowerCompact.includes(email));
}

/** Phones are compared digits-only; "+33 6…" and "06…" are treated as the same number. */
function isGroundedPhone(value: string, cv: CvIndex): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 6) return false;
  const variants = new Set([digits]);
  const national = digits.replace(/^(?:0033|33)/, "");
  if (national !== digits) variants.add(`0${national.replace(/^0/, "")}`);
  if (digits.startsWith("0")) variants.add(`33${digits.slice(1)}`);
  return [...variants].some((v) => cv.digits.includes(v));
}

/** Pitch is generated: it is dropped only if it quotes a number that is not in the CV. */
function isGroundedPitch(value: string, cv: CvIndex): boolean {
  return (value.match(/\d+/g) ?? []).every((n) => cv.numbers.has(n));
}

function clean(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type GroundingResult = { profile: ExtractedProfile; removed: string[] };

export function groundProfile(extracted: ExtractedProfile, cvText: string): GroundingResult {
  const cv = new CvIndex(cvText);
  const removed: string[] = [];

  /** Returns the cleaned value if grounded, else null (and records the path). */
  const keep = (
    path: string,
    value: string | null,
    check: (v: string, cv: CvIndex) => boolean,
  ): string | null => {
    const v = clean(value);
    if (v === null) return null;
    if (check(v, cv)) return v;
    removed.push(path);
    return null;
  };

  const skills: string[] = [];
  extracted.skills.forEach((skill, i) => {
    const v = keep(`skills[${i}]`, skill, isGroundedText);
    if (v !== null && !skills.some((s) => normalizeForMatch(s) === normalizeForMatch(v))) {
      skills.push(v);
    }
  });

  const experiences: Experience[] = [];
  extracted.experiences.forEach((exp, i) => {
    const path = `experiences[${i}]`;
    const title = keep(path, exp.title, isGroundedText);
    if (title === null) return;
    const bullets: string[] = [];
    exp.bullets.forEach((b, j) => {
      const v = keep(`${path}.bullets[${j}]`, b, isGroundedBullet);
      if (v !== null) bullets.push(v);
    });
    experiences.push({
      title,
      company: keep(`${path}.company`, exp.company, isGroundedText),
      start: keep(`${path}.start`, exp.start, isGroundedDate),
      end: keep(`${path}.end`, exp.end, isGroundedDate),
      bullets,
    });
  });

  const education: Education[] = [];
  extracted.education.forEach((edu, i) => {
    const path = `education[${i}]`;
    const degree = keep(path, edu.degree, isGroundedText);
    if (degree === null) return;
    education.push({
      degree,
      school: keep(`${path}.school`, edu.school, isGroundedText),
      start: keep(`${path}.start`, edu.start, isGroundedDate),
      end: keep(`${path}.end`, edu.end, isGroundedDate),
    });
  });

  const languages: Language[] = [];
  extracted.languages.forEach((lang, i) => {
    const path = `languages[${i}]`;
    const language = keep(path, lang.language, isGroundedText);
    if (language === null) return;
    languages.push({ language, level: keep(`${path}.level`, lang.level, isGroundedText) });
  });

  const profile: ExtractedProfile = {
    full_name: keep("full_name", extracted.full_name, isGroundedText),
    email: keep("email", extracted.email, isGroundedEmail),
    phone: keep("phone", extracted.phone, isGroundedPhone),
    city: keep("city", extracted.city, isGroundedText),
    school: keep("school", extracted.school, isGroundedText),
    degree: keep("degree", extracted.degree, isGroundedText),
    skills,
    experiences,
    education,
    languages,
    pitch: keep("pitch", extracted.pitch, isGroundedPitch),
  };

  return { profile, removed };
}
