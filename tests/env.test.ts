import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  getAdminEmails,
  getCronSecret,
  getCryptoKey,
  getLlmEnv,
  getSupabaseEnv,
  resetEnvCacheForTests,
  serverEnv,
} from "@/lib/env";

const fullEnv: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  GOOGLE_REDIRECT_URI: "https://app.example.com/api/google/oauth/callback",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  LLM_API_KEY: "sk-test",
  LLM_MODEL_FAST: "fast-model",
  LLM_MODEL_SMART: "smart-model",
  CRON_SECRET: "cron",
  APP_URL: "https://app.example.com",
};

const ALL_KEYS = [...Object.keys(fullEnv), "LLM_PROVIDER", "RESEND_API_KEY", "ADMIN_EMAILS"];

function stubAll(overrides: Record<string, string | undefined> = {}) {
  for (const k of ALL_KEYS) vi.stubEnv(k, undefined);
  for (const [k, v] of Object.entries({ ...fullEnv, ...overrides })) vi.stubEnv(k, v);
}

describe("env", () => {
  beforeEach(() => resetEnvCacheForTests());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("serverEnv() parses a complete env with defaults", () => {
    stubAll();
    const env = serverEnv();
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.TOKEN_ENCRYPTION_KEY).toHaveLength(32);
  });

  it("serverEnv() is cached", () => {
    stubAll();
    const a = serverEnv();
    vi.stubEnv("CRON_SECRET", "changed");
    expect(serverEnv()).toBe(a);
    resetEnvCacheForTests();
    expect(serverEnv().CRON_SECRET).toBe("changed");
  });

  it("serverEnv() lists every missing var in a bilingual error, without values", () => {
    stubAll({ CRON_SECRET: undefined, LLM_API_KEY: "", GOOGLE_CLIENT_SECRET: "  " });
    let err: unknown;
    try {
      serverEnv();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvError);
    const e = err as EnvError;
    expect(e.variables.sort()).toEqual(["CRON_SECRET", "GOOGLE_CLIENT_SECRET", "LLM_API_KEY"]);
    expect(e.message).toContain("Variables d'environnement manquantes");
    expect(e.message).toContain("Missing or invalid environment variables");
    expect(e.message).not.toContain("service");
    expect(e.message).not.toContain(fullEnv.TOKEN_ENCRYPTION_KEY);
  });

  it("rejects invalid URLs and LLM_PROVIDER values", () => {
    stubAll({ APP_URL: "not a url", LLM_PROVIDER: "mistral" });
    expect(() => serverEnv()).toThrow(/APP_URL[\s\S]*LLM_PROVIDER|LLM_PROVIDER[\s\S]*APP_URL/);
  });

  it("subset getters only validate their own vars", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fullEnv.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    expect(getSupabaseEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("service");
    expect(() => getLlmEnv()).toThrow(EnvError);
    expect(() => getCronSecret()).toThrow(/CRON_SECRET/);
    expect(getAdminEmails()).toEqual([]);
  });

  it("getLlmEnv() accepts openai and normalizes case", () => {
    stubAll({ LLM_PROVIDER: "OpenAI" });
    expect(getLlmEnv().LLM_PROVIDER).toBe("openai");
  });

  it("getAdminEmails() parses a comma list to lowercase", () => {
    expect(getAdminEmails({ ADMIN_EMAILS: " Alice@Example.com, ,BOB@x.fr ," })).toEqual([
      "alice@example.com",
      "bob@x.fr",
    ]);
  });

  it("getCryptoKey() requires exactly 32 decoded bytes", () => {
    const k = randomBytes(32);
    expect(getCryptoKey({ TOKEN_ENCRYPTION_KEY: k.toString("base64") }).equals(k)).toBe(true);
    expect(() =>
      getCryptoKey({ TOKEN_ENCRYPTION_KEY: randomBytes(24).toString("base64") }),
    ).toThrow(/32 bytes/);
    expect(() => getCryptoKey({})).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("no secret var is NEXT_PUBLIC_ prefixed", () => {
    stubAll();
    const publicKeys = Object.keys(serverEnv()).filter((k) => k.startsWith("NEXT_PUBLIC_"));
    expect(publicKeys.sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });
});
