/** Where users land after login when no (valid) `next` is given. */
export const DEFAULT_AFTER_LOGIN_PATH = "/dashboard";

const BASE = "http://local.invalid";

/**
 * Returns `next` only if it is a same-origin relative path ("/dashboard?x=1"),
 * otherwise `fallback`. Prevents open redirects via `?next=` such as
 * "//evil.com", "/\\evil.com", "https://evil.com" or "javascript:...".
 *
 * Accepts the raw searchParams value (string, string[] or missing).
 */
export function safeRedirectPath(
  next: string | string[] | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN_PATH,
): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;

  // Must be a rooted path, never protocol-relative ("//host").
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Browsers normalise "\" to "/", so "/\evil.com" would become "//evil.com".
  if (value.includes("\\")) return fallback;
  // Control characters (tabs/newlines are stripped by URL parsers).
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
