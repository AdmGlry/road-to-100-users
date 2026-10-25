/**
 * Contact finder (SPEC §7.4.2). Builds the ordered list of possible recipients
 * of a lead. The pure part (normalizeNamePart, guessEmailPatterns,
 * buildContactCandidates) is fully unit-tested; findContacts() adds the I/O
 * (website crawl + MX lookup) and never throws.
 *
 * Rules:
 * - address published on the company site:
 *     recruiting / HR local part, or the leader's own address → website / high;
 *     other address (contact@, info@, a named employee) → website / medium;
 * - leader from the companies API + probable formats, ONLY when the domain has
 *   an MX record: prenom.nom → pattern_guess / medium; p.nom, prenom, nom → low;
 * - generic recrutement@, rh@, contact@ (only with MX) → generic / low;
 * - order: website recruiting first; then < 50 employees → leader first,
 *   ≥ 50 or unknown → recruiting / HR first.
 * No SMTP verification. No domain → no candidate (the student types one).
 */
import type { CompanyFacts, ContactCandidate } from "@/lib/hunter/application-types";
import { hasMxRecord as defaultHasMx } from "@/lib/integrations/dns";
import {
  findEmailsOnWebsite as defaultFindEmails,
  isRecruitingAddress,
} from "@/lib/integrations/website";

import { registrableDomain } from "./domains";

export const MAX_CANDIDATES = 8;
export const SMALL_COMPANY_MAX = 50;

/** "Jean Pierre" → "jean-pierre", "D'Arc" → "darc", "Éloïse" → "eloise". */
export function normalizeNamePart(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/['’`]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Probable formats of a leader's address. Empty when a part is unusable. */
export function guessEmailPatterns(
  first: string,
  last: string,
  domain: string,
): { email: string; confidence: "medium" | "low" }[] {
  const f = normalizeNamePart(first);
  const l = normalizeNamePart(last);
  const d = registrableDomain(domain);
  if (!f || !l || !d) return [];
  const out: { email: string; confidence: "medium" | "low" }[] = [
    { email: `${f}.${l}@${d}`, confidence: "medium" },
    { email: `${f[0]}.${l}@${d}`, confidence: "low" },
    { email: `${f}@${d}`, confidence: "low" },
    { email: `${l}@${d}`, confidence: "low" },
  ];
  return out.filter((c, i) => out.findIndex((o) => o.email === c.email) === i);
}

type Leader = { first_name: string; last_name: string; role: string };

const ROLE_PRIORITY: [RegExp, number][] = [
  [/pr[ée]sident|g[ée]rant|directeur g[ée]n[ée]ral|\bdg\b|ceo|fondat/i, 0],
  [/directeur|directrice|dirigeant/i, 1],
];
const rolePriority = (role: string) => ROLE_PRIORITY.find(([re]) => re.test(role))?.[1] ?? 2;

type Ranked = ContactCandidate & { rank: number };

export function buildContactCandidates(input: {
  headcountMin: number | null;
  leaders: readonly Leader[];
  domain: string | null;
  websiteEmails: readonly { email: string }[];
  mxOk: boolean;
}): ContactCandidate[] {
  const domain = input.domain ? registrableDomain(input.domain) : null;
  if (!domain) return [];
  const small = input.headcountMin !== null && input.headcountMin < SMALL_COMPANY_MAX;
  const leaders = [...input.leaders]
    .filter((l) => normalizeNamePart(l.first_name) && normalizeNamePart(l.last_name))
    .sort((a, b) => rolePriority(a.role) - rolePriority(b.role))
    .slice(0, 2);

  // Rank table (lower = better), per company size.
  const R = small
    ? {
        webRecruit: 1,
        webLeader: 0,
        leaderMain: 2,
        webOther: 3,
        leaderOther: 4,
        genRecruit: 5,
        genRh: 6,
        genContact: 7,
      }
    : {
        webRecruit: 0,
        webLeader: 2,
        leaderMain: 4,
        webOther: 1,
        leaderOther: 7,
        genRecruit: 3,
        genRh: 5,
        genContact: 6,
      };

  const list: Ranked[] = [];
  const push = (c: Ranked) => {
    const email = c.email.toLowerCase();
    const existing = list.find((x) => x.email === email);
    if (existing) {
      if (c.rank < existing.rank) Object.assign(existing, { ...c, email });
      return;
    }
    list.push({ ...c, email });
  };

  const leaderEmails = new Map<string, Leader>();
  for (const l of leaders) {
    for (const g of guessEmailPatterns(l.first_name, l.last_name, domain))
      leaderEmails.set(g.email, l);
  }

  for (const { email } of input.websiteEmails) {
    const e = email.trim().toLowerCase();
    if (registrableDomain(e.split("@")[1] ?? "") !== domain) continue;
    const leader = leaderEmails.get(e);
    if (leader) {
      push({
        first_name: leader.first_name,
        last_name: leader.last_name,
        role: leader.role,
        email: e,
        source: "website",
        confidence: "high",
        rank: R.webLeader,
      });
    } else if (isRecruitingAddress(e)) {
      push({
        first_name: null,
        last_name: null,
        role: "Recrutement",
        email: e,
        source: "website",
        confidence: "high",
        rank: R.webRecruit,
      });
    } else {
      push({
        first_name: null,
        last_name: null,
        role: null,
        email: e,
        source: "website",
        confidence: "medium",
        rank: R.webOther,
      });
    }
  }

  if (input.mxOk) {
    leaders.forEach((l, li) => {
      guessEmailPatterns(l.first_name, l.last_name, domain).forEach((g, gi) => {
        if (li > 0 && gi > 0) return; // second leader: prenom.nom only
        push({
          first_name: l.first_name,
          last_name: l.last_name,
          role: l.role,
          email: g.email,
          source: "pattern_guess",
          confidence: g.confidence,
          rank: (gi === 0 ? R.leaderMain : R.leaderOther) + li * 0.5 + gi * 0.01,
        });
      });
    });
    push({
      first_name: null,
      last_name: null,
      role: "Recrutement",
      email: `recrutement@${domain}`,
      source: "generic",
      confidence: "low",
      rank: R.genRecruit,
    });
    push({
      first_name: null,
      last_name: null,
      role: "Ressources humaines",
      email: `rh@${domain}`,
      source: "generic",
      confidence: "low",
      rank: R.genRh,
    });
    push({
      first_name: null,
      last_name: null,
      role: null,
      email: `contact@${domain}`,
      source: "generic",
      confidence: "low",
      rank: R.genContact,
    });
  }

  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.rank - b.c.rank || a.i - b.i)
    .slice(0, MAX_CANDIDATES)
    .map(({ c }) => ({
      first_name: c.first_name,
      last_name: c.last_name,
      role: c.role,
      email: c.email,
      source: c.source,
      confidence: c.confidence,
    }));
}

export type FindContactsDeps = {
  findEmailsOnWebsite?: (domain: string) => Promise<{ email: string; page: string }[]>;
  hasMxRecord?: (domain: string) => Promise<boolean>;
};

/** Candidates for a company, best first. Never throws ([] when nothing usable). */
export async function findContacts(
  company: CompanyFacts,
  deps: FindContactsDeps = {},
): Promise<ContactCandidate[]> {
  const domain =
    (company.domain && registrableDomain(company.domain)) ||
    (company.website && registrableDomain(company.website)) ||
    null;
  if (!domain) return [];
  const findEmails = deps.findEmailsOnWebsite ?? ((d: string) => defaultFindEmails(d));
  const hasMx = deps.hasMxRecord ?? ((d: string) => defaultHasMx(d));
  const [websiteEmails, mxOk] = await Promise.all([
    findEmails(domain).catch(() => []),
    hasMx(domain).catch(() => false),
  ]);
  return buildContactCandidates({
    headcountMin: company.headcount_min,
    leaders: company.leaders,
    domain,
    websiteEmails,
    mxOk,
  });
}
