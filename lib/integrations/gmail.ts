/**
 * Google OAuth + Gmail API (SPEC §6, §7.6). SERVER ONLY.
 *
 * The only module that talks to Google. Tokens and mail contents are never
 * logged, and errors thrown from here carry only status codes / short codes,
 * never the request or response bodies.
 */
import { gmail } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

import { getGoogleEnv } from "@/lib/env";

export type ExchangedTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  email: string;
};

/** Refresh / exchange failure. "invalid_grant" = the refresh token is dead (expired or revoked). */
export class GmailAuthError extends Error {
  readonly code: "invalid_grant" | "other";
  constructor(code: "invalid_grant" | "other", options?: { cause?: unknown }) {
    super(`Google OAuth error (${code})`, options);
    this.name = "GmailAuthError";
    this.code = code;
  }
}

/** users.messages.send failure. `status` is the HTTP status (0 = network / no response). */
export class GmailSendError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  /** Google error reason when present (e.g. "insufficientPermissions"), never a message body. */
  readonly reason: string | null;
  constructor(status: number, reason: string | null, options?: { cause?: unknown }) {
    super(`Gmail send failed (status ${status}${reason ? `, ${reason}` : ""})`, options);
    this.name = "GmailSendError";
    this.status = status;
    this.reason = reason;
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

/** OAuth2 client configured with the Gmail OAuth app (separate from Supabase Auth). */
export function createOAuthClient(): OAuth2Client {
  const env = getGoogleEnv();
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });
}

type GoogleErrorShape = {
  status?: unknown;
  code?: unknown;
  response?: { status?: unknown; data?: unknown };
  errors?: unknown;
};

function httpStatus(err: unknown): number {
  if (!err || typeof err !== "object") return 0;
  const e = err as GoogleErrorShape;
  for (const v of [e.response?.status, e.status, e.code]) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return 0;
}

/** OAuth error code from a token-endpoint failure ("invalid_grant", …). */
function oauthErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as GoogleErrorShape).response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error: unknown }).error;
    if (typeof code === "string") return code;
  }
  // gaxios puts the OAuth error code in the message ("invalid_grant") when data is absent.
  if (err instanceof Error && /\binvalid_grant\b/.test(err.message)) return "invalid_grant";
  return null;
}

/** Google API error reason (first `errors[].reason`), e.g. "insufficientPermissions". */
function apiErrorReason(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as GoogleErrorShape;
  const lists = [
    e.errors,
    (e.response?.data as { error?: { errors?: unknown } } | undefined)?.error?.errors,
  ];
  for (const list of lists) {
    if (Array.isArray(list)) {
      const reason = (list[0] as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === "string" && /^[A-Za-z_]{1,64}$/.test(reason)) return reason;
    }
  }
  return null;
}

/**
 * Exchanges the authorization code. The e-mail comes from the id_token,
 * verified (signature, audience, expiry) by google-auth-library.
 */
export async function exchangeCode(code: string): Promise<ExchangedTokens> {
  const client = createOAuthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (err) {
    throw new GmailAuthError(oauthErrorCode(err) === "invalid_grant" ? "invalid_grant" : "other", {
      cause: httpStatus(err),
    });
  }
  if (!tokens.access_token || !tokens.id_token) throw new GmailAuthError("other");

  let email: string | undefined;
  try {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: getGoogleEnv().GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (payload?.email && payload.email_verified !== false) email = payload.email;
  } catch {
    throw new GmailAuthError("other");
  }
  if (!email) throw new GmailAuthError("other");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: typeof tokens.expiry_date === "number" ? new Date(tokens.expiry_date) : null,
    scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
    email,
  };
}

/** Gets a fresh access token. Throws GmailAuthError ("invalid_grant" when the grant is dead). */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new GmailAuthError("other");
    return {
      accessToken: credentials.access_token,
      expiresAt:
        typeof credentials.expiry_date === "number" ? new Date(credentials.expiry_date) : null,
    };
  } catch (err) {
    if (err instanceof GmailAuthError) throw err;
    throw new GmailAuthError(oauthErrorCode(err) === "invalid_grant" ? "invalid_grant" : "other");
  }
}

/** users.messages.send with a base64url RFC 5322 message. */
export async function sendRawMessage(
  accessToken: string,
  raw: string,
): Promise<{ id: string; threadId: string }> {
  const auth = createOAuthClient();
  auth.setCredentials({ access_token: accessToken });
  const api = gmail({ version: "v1", auth });
  try {
    const res = await api.users.messages.send(
      { userId: "me", requestBody: { raw } },
      { timeout: 20_000, retry: false },
    );
    const id = res.data.id;
    const threadId = res.data.threadId;
    if (!id || !threadId) throw new GmailSendError(502, "missingIds");
    return { id, threadId };
  } catch (err) {
    if (err instanceof GmailSendError) throw err;
    throw new GmailSendError(httpStatus(err), apiErrorReason(err));
  }
}

/** Revokes a token at Google. Best effort: never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await createOAuthClient().revokeToken(token);
  } catch {
    // Already revoked / expired / network: the local row is deleted anyway.
  }
}
