/**
 * Server-side environment access, validated with Zod.
 *
 * SERVER ONLY: never import this module from a client component. Secrets are
 * never prefixed with NEXT_PUBLIC_, so Next.js will not inline them into the
 * browser bundle even if this file were imported by mistake (they would read
 * as undefined and validation would fail loudly).
 *
 * Each consumer should use the smallest getter it needs (getSupabaseEnv,
 * getLlmEnv, ...) so that, e.g., Sprint 0 runs without Gmail or LLM keys.
 * `serverEnv()` validates everything and is meant for health checks / boot.
 */
import { z } from "zod";

type EnvSource = Record<string, string | undefined>;

/** Treats empty / whitespace-only values as missing. */
const required = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string({ error: "missing" }).trim().min(1, { error: "missing" }),
  );

const optional = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().optional(),
  );

const url = () => required().pipe(z.url({ error: "invalid URL" }));

const base64Key32 = () =>
  required()
    .transform((v) => Buffer.from(v, "base64"))
    .refine((buf) => buf.length === 32, {
      error: "must be base64 decoding to exactly 32 bytes",
    });

const adminEmails = () =>
  optional().transform((v) =>
    (v ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );

const llmProvider = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() || undefined : v),
    z
      .enum(["anthropic", "openai"], { error: 'must be "anthropic" or "openai"' })
      .default("anthropic"),
  );

const supabaseShape = {
  NEXT_PUBLIC_SUPABASE_URL: url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(),
  SUPABASE_SERVICE_ROLE_KEY: required(),
};

const googleShape = {
  GOOGLE_CLIENT_ID: required(),
  GOOGLE_CLIENT_SECRET: required(),
  GOOGLE_REDIRECT_URI: url(),
};

const llmShape = {
  LLM_PROVIDER: llmProvider(),
  LLM_API_KEY: required(),
  LLM_MODEL_FAST: required(),
  LLM_MODEL_SMART: required(),
};

const serverShape = {
  ...supabaseShape,
  ...googleShape,
  TOKEN_ENCRYPTION_KEY: base64Key32(),
  ...llmShape,
  CRON_SECRET: required(),
  RESEND_API_KEY: optional(),
  ADMIN_EMAILS: adminEmails(),
  APP_URL: url(),
};

const serverSchema = z.object(serverShape);
const supabaseSchema = z.object(supabaseShape);
const googleSchema = z.object(googleShape);
const llmSchema = z.object(llmShape);
const cryptoSchema = z.object({ TOKEN_ENCRYPTION_KEY: base64Key32() });
const cronSchema = z.object({ CRON_SECRET: required() });
const adminSchema = z.object({ ADMIN_EMAILS: adminEmails() });
const appUrlSchema = z.object({ APP_URL: url() });

export type ServerEnv = z.infer<typeof serverSchema>;
export type SupabaseEnv = z.infer<typeof supabaseSchema>;
export type GoogleEnv = z.infer<typeof googleSchema>;
export type LlmEnv = z.infer<typeof llmSchema>;
export type LlmProviderName = LlmEnv["LLM_PROVIDER"];

/** Thrown when env vars are missing/invalid. Lists variable NAMES only, never values. */
export class EnvError extends Error {
  readonly variables: string[];
  constructor(problems: { name: string; reason: string }[]) {
    const list = problems.map((p) => `  - ${p.name} (${p.reason})`).join("\n");
    super(
      "Variables d'environnement manquantes ou invalides / " +
        "Missing or invalid environment variables:\n" +
        list +
        "\nVoir / See .env.example",
    );
    this.name = "EnvError";
    this.variables = problems.map((p) => p.name);
  }
}

function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const seen = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "?");
    if (!seen.has(name)) seen.set(name, issue.message);
  }
  throw new EnvError([...seen].map(([name, reason]) => ({ name, reason })));
}

let cachedServerEnv: ServerEnv | undefined;

/** Full validated server env (lazy, cached). Throws EnvError listing every problem. */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseEnv(serverSchema, process.env);
  return cachedServerEnv;
}

/** Clears the serverEnv() cache. Intended for tests only. */
export function resetEnvCacheForTests(): void {
  cachedServerEnv = undefined;
}

export function getSupabaseEnv(source: EnvSource = process.env): SupabaseEnv {
  return parseEnv(supabaseSchema, source);
}

export function getGoogleEnv(source: EnvSource = process.env): GoogleEnv {
  return parseEnv(googleSchema, source);
}

export function getLlmEnv(source: EnvSource = process.env): LlmEnv {
  return parseEnv(llmSchema, source);
}

/** The AES-256-GCM key decoded from TOKEN_ENCRYPTION_KEY (exactly 32 bytes). */
export function getCryptoKey(source: EnvSource = process.env): Buffer {
  return parseEnv(cryptoSchema, source).TOKEN_ENCRYPTION_KEY;
}

export function getCronSecret(source: EnvSource = process.env): string {
  return parseEnv(cronSchema, source).CRON_SECRET;
}

/** Admin e-mails, lowercased and trimmed. Empty array when unset. */
export function getAdminEmails(source: EnvSource = process.env): string[] {
  return parseEnv(adminSchema, source).ADMIN_EMAILS;
}

export function getAppUrl(source: EnvSource = process.env): string {
  return parseEnv(appUrlSchema, source).APP_URL;
}

export function getResendApiKey(source: EnvSource = process.env): string | undefined {
  return parseEnv(z.object({ RESEND_API_KEY: optional() }), source).RESEND_API_KEY;
}
