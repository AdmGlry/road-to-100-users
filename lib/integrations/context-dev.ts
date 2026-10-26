/**
 * Context.dev brand lookup (https://docs.context.dev/brand/overview). SERVER ONLY.
 *
 * Used by the preparation queue (SPEC §7.4) to find a company's official
 * website and its careers / contact pages from the company NAME only (public
 * register data). Nothing about the student is ever sent. Optional: without
 * CONTEXT_DEV_API_KEY the client is null and the queue falls back to web
 * search (or no website). Never throws; logs status codes only.
 */
import { z } from "zod";

import { getContextDevApiKey } from "@/lib/env";
import { hostnameOf, isDirectoryDomain, registrableDomain } from "@/lib/hunter/domains";

export const CONTEXT_DEV_BRAND_ENDPOINT = "https://api.context.dev/v1/brand/retrieve";
/** The API rejects longer company names. */
export const MAX_NAME_LENGTH = 30;
const TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

export type CompanySite = {
  /** https origin of the official site ("https://www.acme.fr"). */
  website: string;
  domain: string;
  /** Careers / recruiting page on the same domain, null when unknown. */
  careersUrl: string | null;
  /** Contact page on the same domain, null when unknown. */
  contactUrl: string | null;
};

export interface CompanySiteFinder {
  find(companyName: string): Promise<CompanySite | null>;
}

const responseSchema = z.looseObject({
  brand: z
    .looseObject({
      domain: z.string().nullish(),
      links: z
        .looseObject({
          careers: z.string().nullish().catch(null),
          contact: z.string().nullish().catch(null),
        })
        .nullish()
        .catch(null),
    })
    .nullish(),
});

/** Keeps a page URL only when it is https on the company's own domain. */
export function sameDomainUrl(value: string | null | undefined, domain: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = hostnameOf(url.hostname);
    return host && registrableDomain(host) === domain ? url.toString() : null;
  } catch {
    return null;
  }
}

/** "SOCIÉTÉ  ACME  SAS" → "SOCIÉTÉ ACME SAS", cut at a word boundary under the API limit. */
export function lookupName(name: string): string {
  const flat = name.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_NAME_LENGTH) return flat;
  const cut = flat.slice(0, MAX_NAME_LENGTH);
  if (flat[MAX_NAME_LENGTH] === " ") return cut.trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace >= 3 ? cut.slice(0, lastSpace) : cut).trim();
}

export function createContextDevClient(opts: {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): CompanySiteFinder {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async find(companyName) {
      const name = lookupName(companyName);
      if (name.length < 3) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
      try {
        const res = await doFetch(CONTEXT_DEV_BRAND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ type: "by_name", name, country_gl: "fr" }),
          signal: controller.signal,
        });
        // 400 NOT_FOUND = unknown company: a normal outcome, not an error.
        if (!res.ok) {
          if (res.status !== 400 && res.status !== 404) {
            console.warn(`[context.dev] brand lookup failed (${res.status})`);
          }
          return null;
        }
        const parsed = responseSchema.safeParse(await res.json());
        const rawDomain = parsed.success ? parsed.data.brand?.domain : null;
        const host = rawDomain ? hostnameOf(rawDomain) : null;
        const domain = host ? registrableDomain(host) : null;
        if (!host || !domain || isDirectoryDomain(host)) return null;
        const links = parsed.success ? parsed.data.brand?.links : null;
        return {
          website: `https://${host}`,
          domain,
          careersUrl: sameDomainUrl(links?.careers, domain),
          contactUrl: sameDomainUrl(links?.contact, domain),
        };
      } catch (err) {
        console.warn(
          `[context.dev] brand lookup error (${err instanceof Error ? err.name : "unknown"})`,
        );
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Client from CONTEXT_DEV_API_KEY, or null when it is not set. */
export function getCompanySiteFinder(
  source: Record<string, string | undefined> = process.env,
): CompanySiteFinder | null {
  const apiKey = getContextDevApiKey(source);
  return apiKey ? createContextDevClient({ apiKey }) : null;
}
