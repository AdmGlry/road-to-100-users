import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAVE_ENDPOINT,
  createBraveClient,
  createOpenRouterSearchClient,
  getWebSearchClient,
  OPENROUTER_CHAT_ENDPOINT,
  resetWebSearchWarningsForTests,
  stripHtml,
} from "@/lib/integrations/websearch";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetWebSearchWarningsForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("getWebSearchClient", () => {
  it("returns null by default (WEBSEARCH_PROVIDER=none)", () => {
    expect(getWebSearchClient({})).toBeNull();
    expect(getWebSearchClient({ WEBSEARCH_PROVIDER: "none" })).toBeNull();
  });
  it("returns null when brave has no key, or openrouter without the openrouter LLM provider", () => {
    expect(getWebSearchClient({ WEBSEARCH_PROVIDER: "brave" })).toBeNull();
    expect(
      getWebSearchClient({
        WEBSEARCH_PROVIDER: "openrouter",
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "k",
        LLM_MODEL_FAST: "m",
        LLM_MODEL_SMART: "m",
      }),
    ).toBeNull();
    expect(getWebSearchClient({ WEBSEARCH_PROVIDER: "bogus" })).toBeNull();
  });
  it("builds the configured client", () => {
    expect(
      getWebSearchClient({ WEBSEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "k" }),
    ).not.toBeNull();
    expect(
      getWebSearchClient({
        WEBSEARCH_PROVIDER: "openrouter",
        LLM_PROVIDER: "openrouter",
        LLM_API_KEY: "k",
        LLM_MODEL_FAST: "a:free,b:free",
        LLM_MODEL_SMART: "m",
      }),
    ).not.toBeNull();
  });
});

describe("brave", () => {
  it("sends the key header and maps results", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe(BRAVE_ENDPOINT);
      expect(url.searchParams.get("q")).toBe("ACME Nantes site officiel");
      expect(url.searchParams.get("count")).toBe("3");
      expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("secret");
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "<strong>ACME</strong>",
                url: "https://acme.fr/",
                description: "Le &amp; site",
                page_age: "2026-10-01",
              },
              { title: "dup", url: "https://acme.fr" },
              { title: "bad", url: "javascript:alert(1)" },
            ],
          },
        }),
      );
    });
    const client = createBraveClient({
      apiKey: "secret",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(await client.search("  ACME   Nantes site officiel ", { maxResults: 3 })).toEqual([
      { title: "ACME", url: "https://acme.fr/", snippet: "Le & site", published: "2026-10-01" },
    ]);
  });

  it("returns [] on HTTP errors and network failures", async () => {
    const failing = createBraveClient({
      apiKey: "k",
      fetch: (async () => new Response("", { status: 429 })) as unknown as typeof fetch,
    });
    expect(await failing.search("x")).toEqual([]);
    const throwing = createBraveClient({
      apiKey: "k",
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(await throwing.search("x")).toEqual([]);
  });
});

describe("openrouter web plugin", () => {
  it("sends the web plugin and reads url_citation annotations", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(OPENROUTER_CHAT_ENDPOINT);
      const body = JSON.parse(String(init?.body));
      expect(body.plugins).toEqual([{ id: "web", max_results: 2 }]);
      expect(body.model).toBe("a:free");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "...",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://news.fr/a", title: "A", content: "Texte" },
                  },
                  { type: "other" },
                  { type: "url_citation", url_citation: { url: "ftp://x" } },
                ],
              },
            },
          ],
        }),
      );
    });
    const client = createOpenRouterSearchClient({
      apiKey: "k",
      model: "a:free",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(await client.search("ACME actualité", { maxResults: 2 })).toEqual([
      { title: "A", url: "https://news.fr/a", snippet: "Texte", published: null },
    ]);
  });
});

describe("stripHtml", () => {
  it("removes tags and entities", () => {
    expect(stripHtml("<b>A</b>&nbsp;&quot;B&quot; &#39;C&#39;")).toBe(`A "B" 'C'`);
  });
});
