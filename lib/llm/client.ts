/**
 * Single LLM entry point. SERVER ONLY.
 *
 * - Provider chosen by LLM_PROVIDER (anthropic | openai), model by tier
 *   (LLM_MODEL_FAST / LLM_MODEL_SMART).
 * - Output is JSON validated with a Zod schema; one corrective retry
 *   (2 attempts max, SPEC §13 Sprint 0).
 * - Never logs prompts or responses (they can contain CV / mail contents).
 */
import { z } from "zod";
import { getLlmEnv } from "@/lib/env";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAiProvider } from "./providers/openai";
import type { LlmMessage, LlmProvider } from "./providers/types";

export type { LlmProvider, LlmMessage } from "./providers/types";

export type ModelTier = "fast" | "smart";

export type LlmUsage = { inputTokens: number; outputTokens: number; model: string };

export type LlmUsageEvent = LlmUsage & {
  promptName: string;
  promptVersion: string;
  tier: ModelTier;
  attempts: number;
  success: boolean;
};

export type LlmJsonIssue = { path: PropertyKey[]; message: string };

export type GenerateJsonOptions<T> = {
  prompt: string;
  system?: string;
  schema: z.ZodType<T>;
  tier: ModelTier;
  maxTokens?: number;
  promptName: string;
  promptVersion: string;
  /** Override the configured provider (tests / special cases). */
  provider?: LlmProvider;
  /** Override the model resolved from the tier. */
  model?: string;
  /** Called once per generateJson call (success or failure) with summed usage. */
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
};

export type GenerateJsonResult<T> = { data: T; usage: LlmUsage };

export const MAX_ATTEMPTS = 2;
const DEFAULT_MAX_TOKENS = 2048;
const JSON_INSTRUCTION = "Respond with a single valid JSON value only, no prose, no markdown.";

/** Thrown when the model failed to return schema-valid JSON after MAX_ATTEMPTS. */
export class LlmJsonError extends Error {
  readonly issues: LlmJsonIssue[];
  readonly attempts: number;
  readonly promptName: string;
  readonly promptVersion: string;
  readonly usage: LlmUsage;

  constructor(args: {
    issues: LlmJsonIssue[];
    attempts: number;
    promptName: string;
    promptVersion: string;
    usage: LlmUsage;
  }) {
    // Message contains only prompt identity + issue summary, never content.
    super(
      `LLM returned invalid JSON for prompt "${args.promptName}@${args.promptVersion}" ` +
        `after ${args.attempts} attempts: ${summarizeIssues(args.issues)}`,
    );
    this.name = "LlmJsonError";
    this.issues = args.issues;
    this.attempts = args.attempts;
    this.promptName = args.promptName;
    this.promptVersion = args.promptVersion;
    this.usage = args.usage;
  }
}

// ---------------------------------------------------------------------------
// Provider resolution

let providerOverride: LlmProvider | undefined;
let cachedProvider: LlmProvider | undefined;

/** Force a provider globally (pass undefined to reset). Tests only. */
export function setLlmProviderForTests(provider: LlmProvider | undefined): void {
  providerOverride = provider;
  cachedProvider = undefined;
}

function getProvider(): LlmProvider {
  if (providerOverride) return providerOverride;
  if (!cachedProvider) {
    const env = getLlmEnv();
    cachedProvider =
      env.LLM_PROVIDER === "openai"
        ? new OpenAiProvider({ apiKey: env.LLM_API_KEY })
        : new AnthropicProvider({ apiKey: env.LLM_API_KEY });
  }
  return cachedProvider;
}

export function resolveModel(tier: ModelTier): string {
  const env = getLlmEnv();
  return tier === "smart" ? env.LLM_MODEL_SMART : env.LLM_MODEL_FAST;
}

// ---------------------------------------------------------------------------
// JSON extraction

/**
 * Extracts the first top-level JSON object/array from a model response.
 * Strips ```json fences and surrounding prose. Returns null if none found.
 */
export function extractJson(text: string): string | null {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  const source = fence ? fence[1] : text;

  const start = source.search(/[{[]/);
  if (start === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function summarizeIssues(issues: LlmJsonIssue[]): string {
  return issues
    .slice(0, 10)
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

type ParseOutcome<T> = { ok: true; data: T } | { ok: false; issues: LlmJsonIssue[] };

function parseResponse<T>(text: string, schema: z.ZodType<T>): ParseOutcome<T> {
  const raw = extractJson(text);
  if (raw === null) {
    return { ok: false, issues: [{ path: [], message: "No JSON object or array found" }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Do not propagate the SyntaxError message: it may quote response content.
    return { ok: false, issues: [{ path: [], message: "Response is not valid JSON" }] };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: [...i.path], message: i.message })),
  };
}

function correctionMessage(issues: LlmJsonIssue[]): string {
  return (
    "Your previous answer was not valid for the expected JSON schema. " +
    `Problems: ${summarizeIssues(issues)}. ` +
    "Reply again with ONLY the corrected JSON, no explanation, no markdown fences."
  );
}

// ---------------------------------------------------------------------------
// Public API

export async function generateJson<T>(
  opts: GenerateJsonOptions<T>,
): Promise<GenerateJsonResult<T>> {
  const provider = opts.provider ?? getProvider();
  const model = opts.model ?? resolveModel(opts.tier);
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const system = opts.system ? `${opts.system}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;

  const messages: LlmMessage[] = [{ role: "user", content: opts.prompt }];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, model };
  let issues: LlmJsonIssue[] = [];
  let attempts = 0;

  const report = async (success: boolean) => {
    if (!opts.onUsage) return;
    try {
      await opts.onUsage({
        ...usage,
        promptName: opts.promptName,
        promptVersion: opts.promptVersion,
        tier: opts.tier,
        attempts,
        success,
      });
    } catch {
      // Usage reporting must never break the main flow.
    }
  };

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const res = await provider.complete({ system, messages: [...messages], model, maxTokens });
    usage.inputTokens += res.inputTokens;
    usage.outputTokens += res.outputTokens;

    const outcome = parseResponse(res.text, opts.schema);
    if (outcome.ok) {
      await report(true);
      return { data: outcome.data, usage: { ...usage } };
    }
    issues = outcome.issues;
    messages.push(
      { role: "assistant", content: res.text },
      { role: "user", content: correctionMessage(issues) },
    );
  }

  await report(false);
  throw new LlmJsonError({
    issues,
    attempts,
    promptName: opts.promptName,
    promptVersion: opts.promptVersion,
    usage: { ...usage },
  });
}
