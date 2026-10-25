import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decrypt, encrypt } from "@/lib/crypto";
import {
  DISCONNECTED_SEND_ERROR,
  disconnectGmail,
  getGmailStatus,
  getValidAccessToken,
  GmailNotConnectedError,
  saveConnection,
} from "@/lib/google/connection";
import { GMAIL_SCOPES } from "@/lib/google/oauth";
import { GmailAuthError } from "@/lib/integrations/gmail";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-10-25T10:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "https://app.example/api/google/oauth/callback");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function connection(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER,
    google_email: "lea@gmail.com",
    access_token_enc: encrypt("ya29.old-access"),
    refresh_token_enc: encrypt("1//refresh"),
    scopes: GMAIL_SCOPES,
    expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    status: "active",
    ...overrides,
  };
}

describe("saveConnection", () => {
  it("stores tokens encrypted, never in clear", async () => {
    const { client, table } = createFakeSupabase();
    await saveConnection(client, USER, {
      accessToken: "ya29.secret",
      refreshToken: "1//secret-refresh",
      expiresAt: NOW,
      scopes: GMAIL_SCOPES,
      email: "lea@gmail.com",
    });
    const [row] = table("google_connections");
    expect(JSON.stringify(row)).not.toMatch(/ya29\.|1\/\//);
    expect(decrypt(row.access_token_enc as string)).toBe("ya29.secret");
    expect(decrypt(row.refresh_token_enc as string)).toBe("1//secret-refresh");
    expect(row).toMatchObject({ status: "active", google_email: "lea@gmail.com" });
  });

  it("keeps the stored refresh token when Google omits it, and reactivates", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [connection({ status: "expired" })],
    });
    await saveConnection(client, USER, {
      accessToken: "ya29.new",
      refreshToken: null,
      expiresAt: null,
      scopes: GMAIL_SCOPES,
      email: "lea@gmail.com",
    });
    const rows = table("google_connections");
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].refresh_token_enc as string)).toBe("1//refresh");
    expect(rows[0].status).toBe("active");
  });

  it("revokes the previous grant when a new refresh token replaces it", async () => {
    const { client, table } = createFakeSupabase({ google_connections: [connection()] });
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    await saveConnection(
      client,
      USER,
      {
        accessToken: "ya29.new",
        refreshToken: "1//new-refresh",
        expiresAt: null,
        scopes: GMAIL_SCOPES,
        email: "autre@gmail.com",
      },
      { revokeToken },
    );
    expect(revokeToken).toHaveBeenCalledWith("1//refresh");
    expect(decrypt(table("google_connections")[0].refresh_token_enc as string)).toBe(
      "1//new-refresh",
    );
  });
});

describe("getValidAccessToken", () => {
  it("returns the stored token while it is fresh (no refresh)", async () => {
    const { client } = createFakeSupabase({ google_connections: [connection()] });
    const refreshAccessToken = vi.fn();
    const out = await getValidAccessToken(client, USER, { refreshAccessToken }, NOW);
    expect(out).toEqual({ accessToken: "ya29.old-access", email: "lea@gmail.com" });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when the token expires in less than 2 minutes and stores it encrypted", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [
        connection({ expires_at: new Date(NOW.getTime() + 60_000).toISOString() }),
      ],
    });
    const expiresAt = new Date(NOW.getTime() + 3600_000);
    const refreshAccessToken = vi.fn().mockResolvedValue({ accessToken: "ya29.fresh", expiresAt });
    const out = await getValidAccessToken(client, USER, { refreshAccessToken }, NOW);
    expect(out.accessToken).toBe("ya29.fresh");
    expect(refreshAccessToken).toHaveBeenCalledWith("1//refresh");
    const [row] = table("google_connections");
    expect(decrypt(row.access_token_enc as string)).toBe("ya29.fresh");
    expect(row.expires_at).toBe(expiresAt.toISOString());
  });

  it("marks the connection expired on invalid_grant and throws GmailNotConnectedError", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [connection({ expires_at: null })],
    });
    const refreshAccessToken = vi.fn().mockRejectedValue(new GmailAuthError("invalid_grant"));
    await expect(
      getValidAccessToken(client, USER, { refreshAccessToken }, NOW),
    ).rejects.toMatchObject({ name: "GmailNotConnectedError", code: "expired" });
    expect(table("google_connections")[0].status).toBe("expired");
  });

  it("keeps the connection active on a transient Google error", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [connection({ expires_at: null })],
    });
    const refreshAccessToken = vi.fn().mockRejectedValue(new GmailAuthError("other"));
    await expect(
      getValidAccessToken(client, USER, { refreshAccessToken }, NOW),
    ).rejects.toBeInstanceOf(GmailAuthError);
    expect(table("google_connections")[0].status).toBe("active");
  });

  it("throws not_connected / expired / revoked without calling Google", async () => {
    const refreshAccessToken = vi.fn();
    const none = createFakeSupabase();
    await expect(
      getValidAccessToken(none.client, USER, { refreshAccessToken }),
    ).rejects.toMatchObject({
      code: "not_connected",
    });
    for (const status of ["expired", "revoked"]) {
      const { client } = createFakeSupabase({ google_connections: [connection({ status })] });
      const err = await getValidAccessToken(client, USER, { refreshAccessToken }).catch((e) => e);
      expect(err).toBeInstanceOf(GmailNotConnectedError);
      expect(err.code).toBe(status);
    }
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("treats an undecryptable refresh token as expired", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [connection({ expires_at: null, refresh_token_enc: "v1:bad" })],
    });
    await expect(getValidAccessToken(client, USER, {}, NOW)).rejects.toMatchObject({
      code: "expired",
    });
    expect(table("google_connections")[0].status).toBe("expired");
  });
});

describe("getGmailStatus", () => {
  const rpcClient = (rows: unknown) => createFakeSupabase({}, { rpc: () => rows }).client;

  it("is not_configured without the Google env", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect((await getGmailStatus(rpcClient([]))).state).toBe("not_configured");
  });

  it("maps the token-free RPC row", async () => {
    expect(await getGmailStatus(rpcClient([]))).toEqual({
      state: "not_connected",
      email: null,
      missingScopes: false,
    });
    expect(
      await getGmailStatus(
        rpcClient([{ google_email: "lea@gmail.com", scopes: GMAIL_SCOPES, status: "active" }]),
      ),
    ).toEqual({ state: "active", email: "lea@gmail.com", missingScopes: false });
    expect(
      await getGmailStatus(
        rpcClient([{ google_email: "x@gmail.com", scopes: ["email"], status: "active" }]),
      ),
    ).toMatchObject({ missingScopes: true });
    expect((await getGmailStatus(rpcClient([{ status: "expired", scopes: [] }]))).state).toBe(
      "expired",
    );
  });

  it("does not crash when the RPC fails", async () => {
    const { client } = createFakeSupabase();
    expect((await getGmailStatus(client)).state).toBe("not_connected");
  });
});

describe("disconnectGmail", () => {
  it("revokes the refresh token, deletes the row and unschedules queued mails", async () => {
    const { client, table } = createFakeSupabase({
      google_connections: [connection()],
      applications: [
        {
          id: "a1",
          user_id: USER,
          status: "approved",
          scheduled_for: NOW.toISOString(),
          send_claimed_at: null,
        },
        { id: "a2", user_id: USER, status: "draft", scheduled_for: null },
      ],
    });
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    await disconnectGmail(client, USER, { revokeToken });
    expect(revokeToken).toHaveBeenCalledWith("1//refresh");
    expect(table("google_connections")).toHaveLength(0);
    expect(table("applications")[0]).toMatchObject({
      status: "approved",
      scheduled_for: null,
      send_error: DISCONNECTED_SEND_ERROR,
    });
  });

  it("is a no-op at Google when there is no connection", async () => {
    const { client } = createFakeSupabase();
    const revokeToken = vi.fn();
    await disconnectGmail(client, USER, { revokeToken });
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
