/**
 * Gmail OAuth helpers (SPEC §6.1). SERVER ONLY.
 *
 * The `state` parameter is an HMAC-SHA256 signed payload
 * `{ uid, nonce, exp, next }` (key derived with HKDF from
 * TOKEN_ENCRYPTION_KEY, info "gmail-oauth-state"). The nonce is also stored
 * in an httpOnly cookie by /api/google/oauth/start: the callback only accepts
 * a state that was signed by us, is less than 10 minutes old, belongs to the
 * signed-in user AND matches the cookie of the browser that started the flow
 * (anti-CSRF / login-CSRF).
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { getCryptoKey } from "@/lib/env";
import { createOAuthClient } from "@/lib/integrations/gmail";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, "openid", "email"];

/** Where the student lands after connecting Gmail when no (valid) `next` is given. */
export const GMAIL_DEFAULT_NEXT = "/settings";
/** httpOnly cookie holding the nonce of the pending OAuth flow. */
export const OAUTH_NONCE_COOKIE = "gmail_oauth_nonce";
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

type StatePayload = { uid: string; nonce: string; exp: number; next: string };

function stateKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", getCryptoKey(), Buffer.alloc(0), "gmail-oauth-state", 32),
  );
}

function sign(data: string): Buffer {
  return createHmac("sha256", stateKey()).update(data).digest();
}

function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const x = typeof a === "string" ? Buffer.from(a) : a;
  const y = typeof b === "string" ? Buffer.from(b) : b;
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Builds a signed state for `userId` and the nonce to store in the cookie. */
export function createOAuthState(
  userId: string,
  opts: { now?: number; next?: string } = {},
): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const payload: StatePayload = {
    uid: userId,
    nonce,
    exp: (opts.now ?? Date.now()) + OAUTH_STATE_TTL_MS,
    next: safeRedirectPath(opts.next, GMAIL_DEFAULT_NEXT),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${body}.${sign(body).toString("base64url")}`, nonce };
}

/** Verifies signature, expiry, user and cookie nonce (timing-safe comparisons). */
export function verifyOAuthState(
  state: string,
  nonce: string | undefined,
  userId: string,
  now: number = Date.now(),
): { ok: true; next: string } | { ok: false } {
  if (typeof state !== "string" || state.length > 2048 || !nonce) return { ok: false };
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, mac] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) return { ok: false };

  let expected: Buffer;
  try {
    expected = sign(body);
  } catch {
    return { ok: false };
  }
  if (!safeEqual(Buffer.from(mac, "base64url"), expected)) return { ok: false };

  let payload: Partial<StatePayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StatePayload>;
  } catch {
    return { ok: false };
  }
  if (
    typeof payload.uid !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp <= now
  ) {
    return { ok: false };
  }
  // Evaluate both comparisons (no short-circuit on the first mismatch).
  const sameUser = safeEqual(payload.uid, userId);
  const sameNonce = safeEqual(payload.nonce, nonce);
  if (!sameUser || !sameNonce) return { ok: false };

  return { ok: true, next: safeRedirectPath(payload.next, GMAIL_DEFAULT_NEXT) };
}

/** Google consent URL: offline access (refresh token), consent forced every time. */
export function buildAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
  });
}

/** True when both Gmail scopes the app needs were granted. */
export function hasRequiredScopes(scopes: readonly string[]): boolean {
  return scopes.includes(GMAIL_SEND_SCOPE) && scopes.includes(GMAIL_READONLY_SCOPE);
}
