/**
 * DNS checks for the contact finder (SPEC §7.4.2). SERVER ONLY.
 *
 * hasMxRecord(): does the domain accept e-mail at all? (MX lookup only — we
 * never connect to the mail server: no SMTP "ping" of mailboxes.)
 * Results are cached in memory (positive 6 h, negative 30 min). A DNS timeout
 * or error counts as "no MX" (we then do not guess addresses), cached briefly.
 */
import { resolveMx as nodeResolveMx } from "node:dns/promises";

import { hostnameOf } from "@/lib/hunter/domains";

export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

const DEFAULT_TIMEOUT_MS = 3_000;
const POSITIVE_TTL_MS = 6 * 60 * 60_000;
const NEGATIVE_TTL_MS = 30 * 60_000;
const ERROR_TTL_MS = 2 * 60_000;
const MAX_CACHE_ENTRIES = 2_000;

const cache = new Map<string, { value: boolean; expires: number }>();

function remember(domain: string, value: boolean, ttl: number, now: number) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(domain, { value, expires: now + ttl });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("dns timeout"), { code: "ETIMEOUT" })),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** True when the domain publishes at least one usable MX record (null MX "." excluded). */
export async function hasMxRecord(
  domain: string,
  opts: { resolveMx?: MxResolver; timeoutMs?: number; now?: () => number } = {},
): Promise<boolean> {
  const host = hostnameOf(domain);
  if (!host) return false;
  const now = (opts.now ?? Date.now)();
  const hit = cache.get(host);
  if (hit && hit.expires > now) return hit.value;

  const resolve = opts.resolveMx ?? nodeResolveMx;
  try {
    const records = await withTimeout(resolve(host), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // RFC 7505 "null MX": a single record with exchange "." means "no mail accepted".
    const ok = records.some((r) => r.exchange && r.exchange !== ".");
    remember(host, ok, ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS, now);
    return ok;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "unknown";
    const definitive = code === "ENODATA" || code === "ENOTFOUND";
    if (!definitive) console.warn(`[dns] mx lookup failed (${code})`);
    remember(host, false, definitive ? NEGATIVE_TTL_MS : ERROR_TTL_MS, now);
    return false;
  }
}

/** Tests only. */
export function clearMxCache(): void {
  cache.clear();
}
