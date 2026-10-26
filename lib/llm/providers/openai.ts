import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./types";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type ChatCompletionResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

type OpenAiCompatibleOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
  label?: string;
  extraHeaders?: Record<string, string>;
  /** OpenAI uses `max_completion_tokens`; most compatible APIs only know `max_tokens`. */
  maxTokensParam?: "max_completion_tokens" | "max_tokens";
  /**
   * OpenRouter only: a comma-separated model setting ("a,b,c") is sent as
   * `model: "a", models: ["a","b","c"]` so OpenRouter falls back to the next
   * model when one is rate-limited or unavailable.
   */
  modelFallbacks?: boolean;
  /** Abort a request that takes longer than this (free models can hang). Default 45 s. */
  timeoutMs?: number;
  /** Extra top-level fields of every request body (e.g. OpenRouter provider preferences). */
  extraBody?: Record<string, unknown>;
};

/** Splits "a, b ,c" into ["a","b","c"] (empty entries dropped). */
export function splitModelList(model: string): string[] {
  return model
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** OpenAI-compatible Chat Completions via plain fetch (no SDK), JSON mode enabled. */
export class OpenAiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly label: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxTokensParam: "max_completion_tokens" | "max_tokens";
  private readonly modelFallbacks: boolean;
  private readonly timeoutMs: number;
  private readonly extraBody: Record<string, unknown>;

  constructor(opts: OpenAiCompatibleOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.endpoint = opts.endpoint ?? OPENAI_ENDPOINT;
    this.label = opts.label ?? "OpenAI";
    this.extraHeaders = opts.extraHeaders ?? {};
    this.maxTokensParam = opts.maxTokensParam ?? "max_completion_tokens";
    this.modelFallbacks = opts.modelFallbacks ?? false;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.extraBody = opts.extraBody ?? {};
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const messages = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      ...req.messages,
    ];
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        ...this.extraBody,
        ...this.modelFields(req.model),
        messages,
        [this.maxTokensParam]: req.maxTokens,
        response_format: { type: "json_object" },
      }),
    });

    const body = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    if (!res.ok) {
      // Provider error messages do not echo the prompt; safe to surface.
      throw new Error(
        `${this.label} request failed (${res.status})${body.error?.message ? `: ${body.error.message}` : ""}`,
      );
    }
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }

  private modelFields(model: string): { model: string; models?: string[] } {
    const list = splitModelList(model);
    if (!this.modelFallbacks || list.length <= 1) return { model: list[0] ?? model };
    return { model: list[0], models: list };
  }
}

/** OpenRouter (OpenAI-compatible gateway to many models, incl. free ones). */
export function createOpenRouterProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  appUrl?: string;
  /**
   * Only route to providers that do not store or train on prompts
   * (`provider.data_collection = "deny"`). Excludes most free models.
   */
  denyDataCollection?: boolean;
}): OpenAiProvider {
  return new OpenAiProvider({
    apiKey: opts.apiKey,
    fetch: opts.fetch,
    endpoint: OPENROUTER_ENDPOINT,
    label: "OpenRouter",
    maxTokensParam: "max_tokens",
    modelFallbacks: true,
    extraBody: opts.denyDataCollection ? { provider: { data_collection: "deny" } } : {},
    // Optional attribution headers documented by OpenRouter.
    extraHeaders: {
      ...(opts.appUrl ? { "HTTP-Referer": opts.appUrl } : {}),
      "X-Title": "Spontane",
    },
  });
}
