/**
 * NAF rév. 2 reference (lib/data/naf.json) + deterministic candidate pre-selection
 * for the `map_naf` prompt (SPEC §7.1).
 */
import nafData from "@/lib/data/naf.json";

import { GENERIC_FALLBACK_CODES, ROLE_NAF_HINTS } from "./role-naf-hints";

export type NafEntry = { code: string; label: string; division: string; division_label: string };

export const NAF_CODES: readonly NafEntry[] = (nafData as { codes: NafEntry[] }).codes;

const NAF_BY_CODE: ReadonlyMap<string, NafEntry> = new Map(NAF_CODES.map((e) => [e.code, e]));

/** Normalizes "6202A", "62.02a", " 62.02A " → "62.02A". Returns null when the shape is wrong. */
export function normalizeNafCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const compact = code.trim().toUpperCase().replace(/[\s.]/g, "");
  const m = /^(\d{2})(\d{2})([A-Z])$/.exec(compact);
  return m ? `${m[1]}.${m[2]}${m[3]}` : null;
}

export function isValidNafCode(code: string | null | undefined): boolean {
  const c = normalizeNafCode(code);
  return c !== null && NAF_BY_CODE.has(c);
}

export function nafLabel(code: string | null | undefined): string | null {
  const c = normalizeNafCode(code);
  return c ? (NAF_BY_CODE.get(c)?.label ?? null) : null;
}

export function getNafEntry(code: string | null | undefined): NafEntry | null {
  const c = normalizeNafCode(code);
  return c ? (NAF_BY_CODE.get(c) ?? null) : null;
}

/** Lowercase, accents removed, non-alphanumerics collapsed to single spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whole-word/phrase match; a trailing "*" makes the last word a prefix. */
export function keywordMatches(normalizedText: string, keyword: string): boolean {
  const prefix = keyword.endsWith("*");
  const kw = normalizeText(prefix ? keyword.slice(0, -1) : keyword);
  if (!kw) return false;
  const haystack = ` ${normalizedText} `;
  return haystack.includes(prefix ? ` ${kw}` : ` ${kw} `);
}

/** Hint codes for the given roles/sectors, in hint order, deduplicated. */
export function hintCodesFor(texts: readonly string[]): string[] {
  const normalized = texts.map(normalizeText).filter(Boolean);
  const codes: string[] = [];
  for (const hint of ROLE_NAF_HINTS) {
    if (normalized.some((t) => hint.keywords.some((k) => keywordMatches(t, k)))) {
      for (const c of hint.codes) if (!codes.includes(c)) codes.push(c);
    }
  }
  return codes;
}

const STOPWORDS = new Set([
  "les",
  "des",
  "une",
  "pour",
  "aux",
  "avec",
  "dans",
  "sur",
  "par",
  "chef",
  "charge",
  "chargee",
  "assistant",
  "assistante",
  "junior",
  "senior",
  "stage",
  "stagiaire",
  "alternance",
  "alternant",
  "alternante",
  "apprenti",
  "the",
  "and",
  "master",
  "licence",
  "bachelor",
  "autres",
  "activites",
  "services",
]);

const stem = (word: string) => (word.length > 6 ? word.slice(0, 6) : word);

function keywordStems(texts: readonly string[]): Set<string> {
  const stems = new Set<string>();
  for (const t of texts) {
    for (const w of normalizeText(t).split(" ")) {
      if (w.length >= 4 && !STOPWORDS.has(w)) stems.add(stem(w));
    }
  }
  return stems;
}

const LABEL_STEMS: ReadonlyMap<string, { label: Set<string>; division: Set<string> }> = new Map(
  NAF_CODES.map((e) => [
    e.code,
    {
      label: new Set(normalizeText(e.label).split(" ").filter(Boolean).map(stem)),
      division: new Set(normalizeText(e.division_label).split(" ").filter(Boolean).map(stem)),
    },
  ]),
);

export type NafCandidateInput = {
  roles: readonly string[];
  sectors: readonly string[];
  skills: readonly string[];
  degree: string | null;
};

export const MAX_NAF_CANDIDATES = 80;

/**
 * Deterministic pre-selection of NAF codes to show the model: hint codes first,
 * then codes whose label (or division label) shares words with the roles,
 * sectors, skills or degree, then generic codes. At most `max` entries.
 */
export function preselectNafCandidates(
  input: NafCandidateInput,
  max: number = MAX_NAF_CANDIDATES,
): NafEntry[] {
  const out: NafEntry[] = [];
  const add = (code: string) => {
    const e = NAF_BY_CODE.get(code);
    if (e && out.length < max && !out.includes(e)) out.push(e);
  };

  hintCodesFor([...input.roles, ...input.sectors]).forEach(add);

  // Roles and sectors weigh more than skills/degree.
  const primary = keywordStems([...input.roles, ...input.sectors]);
  const secondary = keywordStems([...input.skills, ...(input.degree ? [input.degree] : [])]);
  const scored: { code: string; score: number }[] = [];
  for (const [code, stems] of LABEL_STEMS) {
    let score = 0;
    for (const s of primary) {
      if (stems.label.has(s)) score += 3;
      else if (stems.division.has(s)) score += 1;
    }
    for (const s of secondary) if (stems.label.has(s)) score += 1;
    if (score > 0) scored.push({ code, score });
  }
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  for (const { code } of scored) add(code);

  GENERIC_FALLBACK_CODES.forEach(add);
  return out;
}
