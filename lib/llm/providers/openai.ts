import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./types";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

type ChatCompletionResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/** OpenAI Chat Completions via plain fetch (no SDK), JSON mode enabled. */
export class OpenAiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; fetch?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const messages = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      ...req.messages,
    ];
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        max_completion_tokens: req.maxTokens,
        response_format: { type: "json_object" },
      }),
    });

    const body = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    if (!res.ok) {
      // Provider error messages do not echo the prompt; safe to surface.
      throw new Error(
        `OpenAI request failed (${res.status})${body.error?.message ? `: ${body.error.message}` : ""}`,
      );
    }
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
}
