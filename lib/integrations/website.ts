/**
 * Finds e-mail addresses published on a company's own website (SPEC §7.4.2 a).
 * SERVER ONLY.
 *
 * SSRF-safe by construction:
 * - https only, on the company's registrable domain (or its subdomains) only;
 * - no IP literals, no localhost / .local; every address the hostname resolves
 *   to must be public (private, loopback, link-local, CGNAT, multicast,
 *   reserved… refused), and the check runs INSIDE the socket's DNS lookup, so
 *   the connection uses exactly the address that was validated (no DNS
 *   rebinding between check and connect);
 * - ≤ 2 redirects per page, each re-validated (same registrable domain, https);
 * - 4 s per request, 500 kB per page (rest discarded), ≤ 5 pages, 15 s overall.
 *
 * Only addresses on the company domain are kept; `mailto:` links, HTML
 * entities and simple obfuscations ("contact [at] acme [dot] fr") are decoded.
 * Never throws (returns []), never logs addresses or page contents.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { hostnameOf, registrableDomain } from "@/lib/hunter/domains";

export type PageFetchResult = {
  status: number;
  /** Location header for 3xx answers. */
  location: string | null;
  contentType: string | null;
  /** Body decoded as UTF-8, truncated to MAX_PAGE_BYTES. */
  body: string;
};

/** Fetches ONE url (no redirect following). Injected in tests. */
export type PageFetcher = (url: URL) => Promise<PageFetchResult>;

export const CANDIDATE_PATHS = [
  "/",
  "/contact",
  "/recrutement",
  "/nous-contacter",
  "/mentions-legales",
  "/carrieres",
  "/jobs",
] as const;
export const MAX_PAGES = 5;
export const MAX_REDIRECTS = 2;
export const REQUEST_TIMEOUT_MS = 4_000;
export const TOTAL_TIMEOUT_MS = 15_000;
export const MAX_PAGE_BYTES = 500 * 1024;
const MAX_DISCOVERED_LINKS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; SpontaneBot/1.0; candidature spontanee)";

/** Local parts of addresses that lead to a recruiter / HR team. */
export const RECRUITING_LOCAL_PART =
  /(^|[._-])(recrutements?|recrut|rh|drh|hr|jobs?|emplois?|careers?|carrieres?|candidatures?|talents?|stages?|alternances?)([._-]|\d|$)/;

/** Addresses that are never useful for an application. */
const JUNK_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|mailer-daemon|postmaster|hostmaster|webmaster|abuse|dpo|rgpd|gdpr|privacy|donnees-?personnelles|unsubscribe|desabonnement|newsletter|factur\w*|compta\w*|invoice\w*|billing|example|exemple|nom|prenom\.nom|votre-?email|email|test)$/;

export function isRecruitingAddress(email: string): boolean {
  return RECRUITING_LOCAL_PART.test(email.split("@")[0]?.toLowerCase() ?? "");
}

// ---------------------------------------------------------------------------
// IP classification

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPublicIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return !V4_BLOCKED.some(([base, bits]) => {
    const b = ipv4ToInt(base) as number;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  });
}

/** Expands an IPv6 address to 8 groups of 16 bits (null if malformed). */
function expandIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  // Embedded IPv4 ("::ffff:1.2.3.4").
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

function isPublicIpv6(ip: string): boolean {
  const g = expandIpv6(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped / IPv4-compatible / NAT64 → check the embedded IPv4.
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4(embedded);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicIpv4(embedded);
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 IETF special (Teredo, ORCHID…)
  if (g[0] === 0x2002) return false; // 6to4 (can embed private IPv4)
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard-only
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6) return isPublicIpv6(ip);
  return false;
}

/** net.LookupFunction that refuses hostnames resolving to any non-public address. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const blocked = Object.assign(new Error("blocked address"), { code: "EBLOCKED" });
      callback(blocked as NodeJS.ErrnoException, "", 4);
      return;
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

// ---------------------------------------------------------------------------
// Default fetcher (node:https with the safe lookup)

export const defaultPageFetcher: PageFetcher = (url) =>
  new Promise<PageFetchResult>((resolve, reject) => {
    if (url.protocol !== "https:") {
      reject(new Error("https only"));
      return;
    }
    const req = httpsRequest(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "Accept-Language": "fr-FR,fr;q=0.9",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = (res.headers["content-type"] as string | undefined) ?? null;
        const location = (res.headers.location as string | undefined) ?? null;
        if ((status >= 300 && status < 400) || status >= 400) {
          res.resume();
          clearTimeout(timer);
          resolve({ status, location, contentType, body: "" });
          return;
        }
        if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
          res.destroy();
          clearTimeout(timer);
          resolve({ status, location, contentType, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({
            status,
            location,
            contentType,
            body: Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES).toString("utf8"),
          });
        };
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_PAGE_BYTES) {
            finish();
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEOUT" }));
    }, REQUEST_TIMEOUT_MS);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });

// ---------------------------------------------------------------------------
// E-mail extraction (pure)

const NAMED_ENTITIES: Record<string, string> = {
  commat: "@",
  period: ".",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

const EMAIL_RE =
  /[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;

/** Addresses of `text` (HTML or plain) whose domain belongs to `domain`, lower-cased, unique. */
export function extractEmails(text: string, domain: string): string[] {
  const base = registrableDomain(domain);
  if (!base) return [];
  let t = decodeEntities(text.slice(0, MAX_PAGE_BYTES * 2));
  t = t.replace(/mailto:([^"'\s>?]+)/gi, (_, addr: string) => {
    try {
      return ` ${decodeURIComponent(addr)} `;
    } catch {
      return ` ${addr} `;
    }
  });
  t = t
    .replace(/\s*[[({]\s*(?:at|arobase|@)\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*(?:dot|point)\s*[\])}]\s*/gi, ".");
  const out: string[] = [];
  for (const m of t.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/\.+$/, "");
    const [local, host] = email.split("@");
    if (!local || !host || local.includes("..")) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(host)) continue;
    if (registrableDomain(host) !== base) continue;
    if (JUNK_LOCAL_PART.test(local)) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

const LINK_KEYWORDS = /contact|recrut|carri|emploi|jobs?\b|rejoindre|join|mentions|legal|equipe/i;

/** Same-site links that probably lead to a contact / careers / legal page. */
export function discoverLinks(html: string, pageUrl: URL, domain: string): string[] {
  const base = registrableDomain(domain);
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]), pageUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || registrableDomain(u.hostname) !== base) continue;
    if (!LINK_KEYWORDS.test(u.pathname)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?)$/i.test(u.pathname)) continue;
    u.hash = "";
    u.search = "";
    const key = u.toString();
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Crawler

/** A URL we may fetch for this company: https, public hostname, same registrable domain. */
export function isAllowedUrl(url: URL, domain: string): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = hostnameOf(url.hostname);
  if (!host || isIP(url.hostname.replace(/^\[|\]$/g, ""))) return false;
  return registrableDomain(host) === registrableDomain(domain);
}

/** Fetches a page following ≤ MAX_REDIRECTS validated redirects. Null on any failure. */
async function fetchPage(
  start: URL,
  domain: string,
  fetcher: PageFetcher,
): Promise<{ url: URL; body: string } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(url, domain)) return null;
    const res = await fetcher(url);
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return null;
      try {
        url = new URL(res.location, url);
      } catch {
        return null;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return null;
    if (res.contentType && !/text\/html|application\/xhtml|text\/plain/i.test(res.contentType)) {
      return null;
    }
    return { url, body: res.body };
  }
  return null;
}

export async function findEmailsOnWebsite(
  domain: string,
  deps: { fetchPage?: PageFetcher; now?: () => number } = {},
): Promise<{ email: string; page: string }[]> {
  const base = registrableDomain(domain);
  if (!base) return [];
  const fetcher = deps.fetchPage ?? defaultPageFetcher;
  const now = deps.now ?? Date.now;
  const deadline = now() + TOTAL_TIMEOUT_MS;
  const found: { email: string; page: string }[] = [];
  const add = (body: string, page: URL) => {
    for (const email of extractEmails(body, base)) {
      if (!found.some((f) => f.email === email)) found.push({ email, page: page.toString() });
    }
  };

  let pages = 0;
  let origin: URL | null = null;
  const queue: string[] = [];
  const visited = new Set<string>();

  try {
    // Home page: apex first, then www (each counts as one page).
    for (const host of [base, `www.${base}`]) {
      if (pages >= MAX_PAGES || now() > deadline) break;
      pages++;
      const start = new URL(`https://${host}/`);
      visited.add(start.toString());
      const page = await fetchPage(start, base, fetcher).catch(() => null);
      if (page) {
        origin = new URL(page.url.origin);
        visited.add(page.url.toString());
        add(page.body, page.url);
        queue.push(...discoverLinks(page.body, page.url, base).slice(0, MAX_DISCOVERED_LINKS));
        break;
      }
    }
    if (!origin) return found;
    for (const path of CANDIDATE_PATHS.slice(1)) queue.push(new URL(path, origin).toString());

    for (const next of queue) {
      if (found.some((f) => isRecruitingAddress(f.email))) break;
      if (pages >= MAX_PAGES || now() > deadline) break;
      const normalized = next.replace(/\/$/, "");
      if ([...visited].some((v) => v.replace(/\/$/, "") === normalized)) continue;
      visited.add(next);
      pages++;
      const page = await fetchPage(new URL(next), base, fetcher).catch(() => null);
      if (page) add(page.body, page.url);
    }
  } catch {
    console.warn("[website] crawl failed (unexpected)");
  }
  return found;
}
