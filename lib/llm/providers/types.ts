export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmCompletionRequest = {
  system?: string;
  messages: LlmMessage[];
  model: string;
  maxTokens: number;
};

export type LlmCompletionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export interface LlmProvider {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
