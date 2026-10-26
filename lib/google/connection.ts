/**
 * Gmail connection storage (SPEC §4 `google_connections`, §6). SERVER ONLY.
 *
 * `google_connections` has no client policy: every read/write of tokens goes
 * through the service-role client, always filtered on a user id verified
 * from the session (routes/actions) or taken from a row the worker owns.
 * Tokens are encrypted at rest with lib/crypto (AES-256-GCM) and never leave
 * this module except as a short-lived access token handed to the Gmail API.
 * The student's UI reads a token-free status through the
 * `google_connection_status()` RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/crypto";
import { isGoogleConfigured } from "@/lib/env";
import { hasRequiredScopes } from "@/lib/google/oauth";
import type { GmailState, GmailStatus } from "@/lib/hunter/application-types";
import {
  GmailAuthError,
  refreshAccessToken as googleRefresh,
  revokeToken as googleRevoke,
  type ExchangedTokens,
} from "@/lib/integrations/gmail";

/** Refresh the access token when it expires in less than this. */
export const REFRESH_MARGIN_MS = 2 * 60_000;

export type GmailNotConnectedCode = "expired" | "not_connected" | "revoked";

/** The student must (re)connect Gmail before anything can be sent. */
export class GmailNotConnectedError extends Error {
  readonly code: GmailNotConnectedCode;
  constructor(code: GmailNotConnectedCode) {
    super(`Gmail not connected (${code})`);
    this.name = "GmailNotConnectedError";
    this.code = code;
  }
}

/** Injectable Google calls (tests). */
export type ConnectionDeps = {
  refreshAccessToken: typeof googleRefresh;
  revokeToken: typeof googleRevoke;
};

const defaultDeps: ConnectionDeps = {
  refreshAccessToken: googleRefresh,
  revokeToken: googleRevoke,
};

function dbError(op: string, error: { code?: string } | null): Error {
  return new Error(`google_connections ${op} failed (${error?.code ?? "unknown"})`);
}

/** Upserts the connection with encrypted tokens and status "active". */
export async function saveConnection(
  admin: SupabaseClient,
  userId: string,
  tokens: ExchangedTokens,
  deps: Partial<ConnectionDeps> = {},
): Promise<void> {
  const { revokeToken } = { ...defaultDeps, ...deps };
  // A new refresh token replaces the stored one: revoke the old grant
  // (best effort, e.g. reconnecting with another Google account).
  let previousRefresh: string | null = null;
  if (tokens.refreshToken) {
    const { data: prev } = await admin
      .from("google_connections")
      .select("refresh_token_enc")
      .eq("user_id", userId)
      .maybeSingle();
    const enc = (prev as { refresh_token_enc?: string | null } | null)?.refresh_token_enc;
    if (enc) {
      try {
        previousRefresh = decrypt(enc);
      } catch {
        previousRefresh = null;
      }
    }
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    google_email: tokens.email,
    access_token_enc: encrypt(tokens.accessToken),
    scopes: tokens.scopes,
    expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
    status: "active",
  };
  // Google may omit the refresh token on a re-consent: keep the stored one then.
  if (tokens.refreshToken) row.refresh_token_enc = encrypt(tokens.refreshToken);

  const { error } = await admin.from("google_connections").upsert(row, { onConflict: "user_id" });
  if (error) throw dbError("upsert", error);

  if (previousRefresh && previousRefresh !== tokens.refreshToken) {
    try {
      await revokeToken(previousRefresh);
    } catch {
      console.error("[gmail] previous token revoke failed");
    }
  }
}

type StatusRow = { google_email: string | null; scopes: string[] | null; status: string | null };

/** Token-free status for the signed-in user (user client, RLS-safe RPC). Never throws. */
export async function getGmailStatus(supabase: SupabaseClient): Promise<GmailStatus> {
  if (!isGoogleConfigured()) return { state: "not_configured", email: null, missingScopes: false };
  try {
    const { data, error } = await supabase.rpc("google_connection_status");
    if (error) throw dbError("status rpc", error);
    const row = (Array.isArray(data) ? data[0] : data) as StatusRow | null | undefined;
    if (!row) return { state: "not_connected", email: null, missingScopes: false };
    const state: GmailState =
      row.status === "expired" || row.status === "revoked" ? row.status : "active";
    return {
      state,
      email: row.google_email ?? null,
      missingScopes: !hasRequiredScopes(row.scopes ?? []),
    };
  } catch (err) {
    console.error("[gmail] status failed", { name: err instanceof Error ? err.name : "unknown" });
    return { state: "not_connected", email: null, missingScopes: false };
  }
}

type ConnectionRow = {
  google_email: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string;
};

async function markExpired(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin
    .from("google_connections")
    .update({ status: "expired" })
    .eq("user_id", userId);
  if (error) console.error("[gmail] mark expired failed", { code: error.code ?? "unknown" });
}

/**
 * A usable access token for `userId` (service-role client), refreshed when it
 * expires in less than 2 minutes. A dead grant (invalid_grant, undecryptable
 * token) marks the connection "expired" and throws GmailNotConnectedError.
 * A transient Google failure throws GmailAuthError("other").
 */
export async function getValidAccessToken(
  admin: SupabaseClient,
  userId: string,
  deps: Partial<ConnectionDeps> = {},
  now: Date = new Date(),
): Promise<{ accessToken: string; email: string }> {
  const { refreshAccessToken } = { ...defaultDeps, ...deps };
  const { data, error } = await admin
    .from("google_connections")
    .select("google_email, access_token_enc, refresh_token_enc, expires_at, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("select", error);
  const row = data as ConnectionRow | null;
  if (!row) throw new GmailNotConnectedError("not_connected");
  if (row.status === "revoked") throw new GmailNotConnectedError("revoked");
  if (row.status === "expired") throw new GmailNotConnectedError("expired");

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : NaN;
  const fresh = Number.isFinite(expiresAt) && expiresAt - now.getTime() > REFRESH_MARGIN_MS;
  if (fresh) {
    try {
      return { accessToken: decrypt(row.access_token_enc), email: row.google_email };
    } catch {
      // Unreadable (key rotated / tampered): fall through to a refresh.
    }
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) {
    await markExpired(admin, userId);
    throw new GmailNotConnectedError("expired");
  }

  let refreshed: { accessToken: string; expiresAt: Date | null };
  try {
    refreshed = await refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof GmailAuthError && err.code === "invalid_grant") {
      await markExpired(admin, userId);
      throw new GmailNotConnectedError("expired");
    }
    throw err instanceof GmailAuthError ? err : new GmailAuthError("other");
  }

  const { error: updateError } = await admin
    .from("google_connections")
    .update({
      access_token_enc: encrypt(refreshed.accessToken),
      expires_at: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
    })
    .eq("user_id", userId);
  // The fresh token is still usable for this call even if caching it failed.
  if (updateError) console.error("[gmail] token update failed", { code: updateError.code ?? "" });

  return { accessToken: refreshed.accessToken, email: row.google_email };
}

/** Mail queued for sending must not wait for a connection that no longer exists. */
export const DISCONNECTED_SEND_ERROR =
  "Gmail est déconnecté : reconnecte-le puis relance l'envoi de ce mail.";

/**
 * Revokes the grant at Google (best effort), deletes the row and takes the
 * student's queued mails out of the send queue (they stay validated).
 */
export async function disconnectGmail(
  admin: SupabaseClient,
  userId: string,
  deps: Partial<ConnectionDeps> = {},
): Promise<void> {
  const { revokeToken } = { ...defaultDeps, ...deps };
  const { data, error } = await admin
    .from("google_connections")
    .select("access_token_enc, refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("select", error);

  const row = data as Pick<ConnectionRow, "access_token_enc" | "refresh_token_enc"> | null;
  if (row) {
    // Revoking the refresh token revokes the whole grant (and its access tokens).
    let token: string | null = null;
    for (const enc of [row.refresh_token_enc, row.access_token_enc]) {
      if (!enc || token) continue;
      try {
        token = decrypt(enc);
      } catch {
        token = null;
      }
    }
    if (token) await revokeToken(token);

    const { error: deleteError } = await admin
      .from("google_connections")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw dbError("delete", deleteError);
  }

  const { error: queueError } = await admin
    .from("applications")
    .update({ scheduled_for: null, send_error: DISCONNECTED_SEND_ERROR })
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("scheduled_for", "is", null)
    .is("send_claimed_at", null);
  if (queueError) console.error("[gmail] unschedule failed", { code: queueError.code ?? "" });
}
