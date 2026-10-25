/**
 * Company website / domain helpers (SPEC §7.4 step 1). Pure, no I/O.
 *
 * - registrableDomain(): "https://www.acme.fr/contact" → "acme.fr" (handles the
 *   few multi-label public suffixes we meet in practice: "co.uk", "com.fr"…).
 * - pickOfficialWebsite(): picks, among web search results, the one that most
 *   likely is the company's own site. Directories, social networks, job
 *   boards, public registries and news media are never picked, and the domain
 *   itself must look like the company name (a news article about the company
 *   hosted on a media site must not become its "website").
 */
import { normalizeForMatch } from "@/lib/profile/grounding";

import type { WebResult } from "@/lib/integrations/websearch";

/**
 * Domains that are never a company's official site (registrable domains).
 * Brands present under many TLDs (indeed.fr, indeed.com…) are matched by
 * DIRECTORY_BRANDS instead.
 */
export const DIRECTORY_DOMAINS: readonly string[] = [
  // Company registries / directories
  "societe.com",
  "pagesjaunes.fr",
  "pappers.fr",
  "verif.com",
  "infogreffe.fr",
  "annuaire-entreprises.data.gouv.fr",
  "data.gouv.fr",
  "gouv.fr",
  "manageo.fr",
  "corporama.com",
  "kompass.com",
  "societeinfo.com",
  "infonet.fr",
  "score3.fr",
  "bodacc.fr",
  "entreprises.lefigaro.fr",
  "lefigaro.fr",
  "dnb.com",
  "europages.fr",
  "118712.fr",
  "118000.fr",
  "annuaire.com",
  "hoodspot.fr",
  "mappy.com",
  "yelp.fr",
  "tripadvisor.fr",
  "trustpilot.com",
  "lagazettefrance.fr",
  "net-entreprises.fr",
  "entreprises.lesechos.fr",
  "lesechos.fr",
  "dirigeant.societe.com",
  "sirene.fr",
  "insee.fr",
  "annuaire-entreprises.fr",
  "doctrine.fr",
  "fr.kompass.com",
  // Social networks / platforms
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "wikipedia.org",
  "wikimedia.org",
  "glassdoor.fr",
  "glassdoor.com",
  "wix.com",
  "wixsite.com",
  "free.fr",
  "orange.fr",
  "wanadoo.fr",
  "blogspot.com",
  "wordpress.com",
  "medium.com",
  "github.com",
  // Job boards
  "welcometothejungle.com",
  "hellowork.com",
  "monster.fr",
  "apec.fr",
  "francetravail.fr",
  "pole-emploi.fr",
  "jobteaser.com",
  "labonnealternance.apprentissage.beta.gouv.fr",
  "1jeune1solution.gouv.fr",
  "meteojob.com",
  "regionsjob.com",
  "cadremploi.fr",
  "keljob.com",
  "jobijoba.com",
  "talent.com",
  "studentjob.fr",
  "letudiant.fr",
  "staffme.fr",
  "optioncarriere.com",
  // News media
  "ouest-france.fr",
  "lemonde.fr",
  "liberation.fr",
  "20minutes.fr",
  "francebleu.fr",
  "francetvinfo.fr",
  "bfmtv.com",
  "latribune.fr",
  "usinenouvelle.com",
  "journaldunet.com",
  "presse-ocean.fr",
  "actu.fr",
  "maddyness.com",
  "challenges.fr",
  "capital.fr",
  "lexpress.fr",
  "lepoint.fr",
  "leparisien.fr",
  "sudouest.fr",
  "ladepeche.fr",
  "leprogres.fr",
  "lavoixdunord.fr",
  "letelegramme.fr",
  "dna.fr",
  "estrepublicain.fr",
  "midilibre.fr",
  "nicematin.com",
  "laprovence.com",
  "lejsl.com",
  "zonebourse.com",
  "boursorama.com",
];

/** Brands matched whatever their TLD ("indeed.fr", "google.de", "amazon.com"…). */
export const DIRECTORY_BRANDS: readonly string[] = [
  "indeed",
  "google",
  "bing",
  "yahoo",
  "duckduckgo",
  "qwant",
  "linkedin",
  "facebook",
  "wikipedia",
  "societe",
  "pagesjaunes",
  "pappers",
  "kompass",
  "glassdoor",
  "amazon",
  "apple",
  "microsoft",
  "youtube",
];

/** Public suffixes made of two labels that we may meet (French companies mostly use .fr/.com). */
const MULTI_LABEL_SUFFIXES = new Set([
  "com.fr",
  "asso.fr",
  "nom.fr",
  "tm.fr",
  "gouv.fr",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "co.nz",
  "co.jp",
  "com.br",
  "com.es",
  "co.za",
  "com.tr",
  "com.cn",
  "com.mx",
  "co.in",
  "com.be",
]);

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True for "1.2.3.4", "[::1]", "::1"… */
export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  return h.includes(":");
}

/**
 * Lower-cased hostname of a URL or bare host, without "www." and trailing dot.
 * Null for IP literals, localhost, single-label or malformed hosts.
 */
export function hostnameOf(urlOrHost: string): string | null {
  const raw = urlOrHost.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || isIpLiteral(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l))) return null;
  if (!/^[a-z]{2,}$|^xn--[a-z0-9-]+$/.test(labels[labels.length - 1])) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  return host;
}

/** "https://www.shop.acme.co.uk/x" → "acme.co.uk"; null when not a public hostname. */
export function registrableDomain(urlOrHost: string): string | null {
  const host = hostnameOf(urlOrHost);
  if (!host) return null;
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < take) return null;
  return labels.slice(-take).join(".");
}

/** True when the domain (or one of its parents) is a directory / platform / media. */
export function isDirectoryDomain(urlOrHost: string): boolean {
  const host = hostnameOf(urlOrHost);
  if (!host) return true;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DIRECTORY_DOMAINS.includes(labels.slice(i).join("."))) return true;
  }
  const reg = registrableDomain(host);
  const brand = reg?.split(".")[0] ?? "";
  return DIRECTORY_BRANDS.includes(brand);
}

/** Legal forms and filler words removed from a company name before matching. */
const NAME_NOISE = new Set([
  "sa",
  "sas",
  "sasu",
  "sarl",
  "eurl",
  "sci",
  "snc",
  "scop",
  "scm",
  "selarl",
  "gie",
  "groupe",
  "group",
  "societe",
  "ste",
  "ets",
  "etablissements",
  "et",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "l",
  "d",
  "france",
  "the",
  "and",
  "cie",
  "compagnie",
]);

/** Significant normalized tokens of a company name ("SARL Boulangerie Dupont" → ["boulangerie","dupont"]). */
export function companyNameTokens(name: string): string[] {
  return normalizeForMatch(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_NOISE.has(t));
}

/**
 * How well a domain matches the company name:
 * 3 = the domain label contains the whole compact name (or vice versa, ≥ 4 chars),
 * 2 = it contains a significant name token (≥ 4 chars),
 * 1 = it contains a 3-letter token / the initials,
 * 0 = no match.
 */
export function domainNameMatch(domain: string, companyName: string): number {
  const label = domain.split(".")[0].replace(/-/g, "");
  if (!label) return 0;
  const tokens = companyNameTokens(companyName);
  const compact = tokens.join("");
  if (
    compact.length >= 4 &&
    (label.includes(compact) || (label.length >= 4 && compact.includes(label)))
  ) {
    return 3;
  }
  if (tokens.some((t) => t.length >= 4 && label.includes(t))) return 2;
  const initials = normalizeForMatch(companyName)
    .split(" ")
    .filter((t) => t && !NAME_NOISE.has(t))
    .map((t) => t[0])
    .join("");
  if (tokens.some((t) => t.length === 3 && label.includes(t))) return 1;
  if (initials.length >= 2 && label === initials) return 1;
  return 0;
}

/**
 * Best official-website candidate among search results, or null.
 * Score = name match of the domain (required, ≥ 1) + title mention + rank bonus.
 * The returned website is the https origin of the host found ("https://www.acme.fr").
 */
export function pickOfficialWebsite(
  results: readonly WebResult[],
  companyName: string,
): { website: string; domain: string } | null {
  const tokens = companyNameTokens(companyName);
  let best: { website: string; domain: string; score: number } | null = null;
  for (const [index, r] of results.entries()) {
    let url: URL;
    try {
      url = new URL(r.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const host = hostnameOf(url.hostname);
    const domain = host ? registrableDomain(host) : null;
    if (!host || !domain || isDirectoryDomain(host)) continue;
    const match = domainNameMatch(domain, companyName);
    if (match === 0) continue;
    const title = normalizeForMatch(r.title);
    const titleHit = tokens.length > 0 && tokens.some((t) => title.includes(t)) ? 1 : 0;
    const rootBonus = url.pathname === "/" || url.pathname === "" ? 0.5 : 0;
    const score = match * 2 + titleHit + rootBonus + Math.max(0, 1 - index * 0.2);
    if (!best || score > best.score) {
      best = { website: `https://${host}`, domain, score };
    }
  }
  return best ? { website: best.website, domain: best.domain } : null;
}
