import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthUrl,
  createOAuthState,
  GMAIL_SCOPES,
  hasRequiredScopes,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from "@/lib/google/oauth";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const NOW = Date.UTC(2026, 9, 25, 10, 0, 0);

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "https://app.example/api/google/oauth/callback");
});
afterEach(() => vi.unstubAllEnvs());

describe("OAuth state", () => {
  it("round-trips for the same user, nonce and time window", () => {
    const { state, nonce } = createOAuthState(USER, { now: NOW, next: "/hunter/review" });
    expect(verifyOAuthState(state, nonce, USER, NOW + 60_000)).toEqual({
      ok: true,
      next: "/hunter/review",
    });
  });

  it("rejects another user, another nonce, a missing nonce and an expired state", () => {
    const { state, nonce } = createOAuthState(USER, { now: NOW });
    expect(verifyOAuthState(state, nonce, OTHER, NOW).ok).toBe(false);
    expect(verifyOAuthState(state, "other-nonce", USER, NOW).ok).toBe(false);
    expect(verifyOAuthState(state, undefined, USER, NOW).ok).toBe(false);
    expect(verifyOAuthState(state, nonce, USER, NOW + OAUTH_STATE_TTL_MS + 1).ok).toBe(false);
  });

  it("rejects tampered payloads and signatures", () => {
    const { state, nonce } = createOAuthState(USER, { now: NOW });
    const [body, mac] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ uid: OTHER, nonce, exp: NOW + 1e9, next: "/settings" }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${mac}`, nonce, OTHER, NOW).ok).toBe(false);
    expect(verifyOAuthState(`${body}.${mac.slice(0, -2)}AA`, nonce, USER, NOW).ok).toBe(false);
    expect(verifyOAuthState("garbage", nonce, USER, NOW).ok).toBe(false);
    expect(verifyOAuthState("", nonce, USER, NOW).ok).toBe(false);
  });

  it("rejects a state signed with another key", () => {
    const { state, nonce } = createOAuthState(USER, { now: NOW });
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(verifyOAuthState(state, nonce, USER, NOW).ok).toBe(false);
  });

  it("sanitises next (open redirect) to /settings", () => {
    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      const { state, nonce } = createOAuthState(USER, { now: NOW, next });
      expect(verifyOAuthState(state, nonce, USER, NOW)).toEqual({ ok: true, next: "/settings" });
    }
  });
});

describe("buildAuthUrl", () => {
  it("asks for offline access, forced consent and the Gmail scopes", () => {
    const url = new URL(buildAuthUrl("the-state"));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/google/oauth/callback",
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(GMAIL_SCOPES);
  });
});

describe("hasRequiredScopes", () => {
  it("requires gmail.send and gmail.readonly", () => {
    expect(hasRequiredScopes(GMAIL_SCOPES)).toBe(true);
    expect(hasRequiredScopes(["https://www.googleapis.com/auth/gmail.send", "email"])).toBe(false);
    expect(hasRequiredScopes([])).toBe(false);
  });
});
