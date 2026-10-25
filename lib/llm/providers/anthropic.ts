import Anthropic from "@anthropic-ai/sdk";
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./types";

type MessagesClient = Pick<Anthropic, "messages">;

export class AnthropicProvider implements LlmProvider {
  private readonly client: MessagesClient;

  /** Pass `client` to inject a fake in tests. */
  constructor(opts: { apiKey: string; client?: MessagesClient }) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
