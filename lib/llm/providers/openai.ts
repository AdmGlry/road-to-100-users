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
};

/** OpenAI-compatible Chat Completions via plain fetch (no SDK), JSON mode enabled. */
export class OpenAiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly label: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxTokensParam: "max_completion_tokens" | "max_tokens";

  constructor(opts: OpenAiCompatibleOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.endpoint = opts.endpoint ?? OPENAI_ENDPOINT;
    this.label = opts.label ?? "OpenAI";
    this.extraHeaders = opts.extraHeaders ?? {};
    this.maxTokensParam = opts.maxTokensParam ?? "max_completion_tokens";
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const messages = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      ...req.messages,
    ];
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: req.model,
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
}

/** OpenRouter (OpenAI-compatible gateway to many models, incl. free ones). */
export function createOpenRouterProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  appUrl?: string;
}): OpenAiProvider {
  return new OpenAiProvider({
    apiKey: opts.apiKey,
    fetch: opts.fetch,
    endpoint: OPENROUTER_ENDPOINT,
    label: "OpenRouter",
    maxTokensParam: "max_tokens",
    // Optional attribution headers documented by OpenRouter.
    extraHeaders: {
      ...(opts.appUrl ? { "HTTP-Referer": opts.appUrl } : {}),
      "X-Title": "Spontane",
    },
  });
}
