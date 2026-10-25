import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  extractJson,
  generateJson,
  LlmJsonError,
  setLlmProviderForTests,
  type LlmProvider,
} from "@/lib/llm/client";
import type { LlmCompletionRequest } from "@/lib/llm/providers/types";
import { AnthropicProvider } from "@/lib/llm/providers/anthropic";
import { OpenAiProvider } from "@/lib/llm/providers/openai";

const schema = z.object({ name: z.string(), score: z.number().int().min(0).max(100) });

function fakeProvider(responses: string[]) {
  const calls: LlmCompletionRequest[] = [];
  let i = 0;
  const provider: LlmProvider = {
    complete: vi.fn(async (req: LlmCompletionRequest) => {
      calls.push(structuredClone(req));
      const text = responses[Math.min(i, responses.length - 1)];
      i++;
      return { text, inputTokens: 100, outputTokens: 20 };
    }),
  };
  return { provider, calls };
}

const base = {
  prompt: "Score this company",
  schema,
  tier: "fast" as const,
  promptName: "score_company",
  promptVersion: "1",
};

describe("extractJson", () => {
  it("handles fences, prose and nested braces in strings", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Voici : {"a":"}{","b":[1,{"c":2}]} merci')).toBe(
      '{"a":"}{","b":[1,{"c":2}]}',
    );
    expect(extractJson("[1,2] and {}")).toBe("[1,2]");
    expect(extractJson('{"a":"\\"}"}')).toBe('{"a":"\\"}"}');
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"a":1')).toBeNull();
  });
});

describe("generateJson", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL_FAST", "model-fast");
    vi.stubEnv("LLM_MODEL_SMART", "model-smart");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLlmProviderForTests(undefined);
  });

  it("returns data on a valid first try", async () => {
    const { provider, calls } = fakeProvider(['{"name":"Acme","score":82}']);
    const res = await generateJson({ ...base, provider });
    expect(res.data).toEqual({ name: "Acme", score: 82 });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, model: "model-fast" });
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual([{ role: "user", content: "Score this company" }]);
    expect(calls[0].maxTokens).toBeGreaterThan(0);
  });

  it("parses fenced JSON with surrounding prose", async () => {
    const { provider } = fakeProvider(['Sure!\n```json\n{"name":"Acme","score":5}\n```\nDone.']);
    const res = await generateJson({ ...base, provider });
    expect(res.data.score).toBe(5);
  });

  it("retries once on invalid JSON, then succeeds, summing usage", async () => {
    const { provider, calls } = fakeProvider(["{name: Acme}", '{"name":"Acme","score":50}']);
    const res = await generateJson({ ...base, provider });
    expect(res.data.score).toBe(50);
    expect(calls).toHaveLength(2);
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 40, model: "model-fast" });
    const second = calls[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: "assistant", content: "{name: Acme}" });
    expect(second[2].role).toBe("user");
    expect(second[2].content).toMatch(/not valid JSON/);
  });

  it("retries on schema mismatch with the Zod issue summary", async () => {
    const { provider, calls } = fakeProvider([
      '{"name":"Acme","score":"high"}',
      '{"name":"Acme","score":90}',
    ]);
    const res = await generateJson({ ...base, provider });
    expect(res.data.score).toBe(90);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[2].content).toContain("score");
  });

  it("throws LlmJsonError after two invalid attempts", async () => {
    const { provider, calls } = fakeProvider(['{"name":"Acme"}', "still nothing"]);
    const onUsage = vi.fn();
    const err = await generateJson({ ...base, provider, onUsage }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmJsonError);
    const e = err as LlmJsonError;
    expect(calls).toHaveLength(2);
    expect(e.attempts).toBe(2);
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.usage.inputTokens).toBe(200);
    expect(e.message).toContain("score_company@1");
    expect(e.message).not.toContain("still nothing");
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, attempts: 2, inputTokens: 200 }),
    );
  });

  it("uses the smart model for the smart tier and appends a JSON instruction to system", async () => {
    const { provider, calls } = fakeProvider(['{"name":"A","score":1}']);
    await generateJson({ ...base, tier: "smart", system: "Tu es un assistant.", provider });
    expect(calls[0].model).toBe("model-smart");
    expect(calls[0].system).toMatch(/^Tu es un assistant\./);
    expect(calls[0].system).toMatch(/JSON/);
  });

  it("calls onUsage on success and swallows onUsage errors", async () => {
    const { provider } = fakeProvider(['{"name":"A","score":1}']);
    const onUsage = vi.fn(() => {
      throw new Error("db down");
    });
    const res = await generateJson({ ...base, provider, onUsage });
    expect(res.data.name).toBe("A");
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 100,
      outputTokens: 20,
      model: "model-fast",
      promptName: "score_company",
      promptVersion: "1",
      tier: "fast",
      attempts: 1,
      success: true,
    });
  });

  it("supports setLlmProviderForTests", async () => {
    const { provider, calls } = fakeProvider(['[{"name":"A","score":1}]']);
    setLlmProviderForTests(provider);
    const res = await generateJson({ ...base, schema: z.array(schema) });
    expect(res.data).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("does not log prompt or response contents", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { provider } = fakeProvider(["bad", "bad"]);
    await generateJson({ ...base, prompt: "CV SECRET", provider }).catch(() => {});
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe("providers", () => {
  it("AnthropicProvider maps request and joins text blocks", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: '{"a":' },
        { type: "thinking", thinking: "..." },
        { type: "text", text: "1}" },
      ],
      usage: { input_tokens: 11, output_tokens: 7 },
    }));
    const client = { messages: { create } } as unknown as ConstructorParameters<
      typeof AnthropicProvider
    >[0]["client"];
    const p = new AnthropicProvider({ apiKey: "k", client });
    const res = await p.complete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "m",
      maxTokens: 50,
    });
    expect(res).toEqual({ text: '{"a":1}', inputTokens: 11, outputTokens: 7 });
    expect(create).toHaveBeenCalledWith({
      model: "m",
      max_tokens: 50,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("OpenAiProvider posts JSON-mode chat completion via fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"a":1}' } }],
            usage: { prompt_tokens: 9, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    const p = new OpenAiProvider({ apiKey: "sk-x", fetch: fetchMock as typeof fetch });
    const res = await p.complete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-x",
      maxTokens: 30,
    });
    expect(res).toEqual({ text: '{"a":1}', inputTokens: 9, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-x");
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("gpt-x");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("OpenAiProvider throws on HTTP errors", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
    );
    const p = new OpenAiProvider({ apiKey: "sk-x", fetch: fetchMock as typeof fetch });
    await expect(
      p.complete({ messages: [{ role: "user", content: "hi" }], model: "m", maxTokens: 1 }),
    ).rejects.toThrow(/401.*bad key/);
  });
});
