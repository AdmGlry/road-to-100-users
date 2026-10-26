/**
 * Web search used by the hunter enrichment (SPEC §7.4: official website + one
 * recent fact about the company). SERVER ONLY.
 *
 * Provider chosen by WEBSEARCH_PROVIDER:
 * - "none" (default): no web search, getWebSearchClient() returns null and the
 *   pipeline falls back to activity-based hooks / no website.
 * - "brave": Brave Search API (api.search.brave.com, header X-Subscription-Token).
 * - "openrouter": OpenRouter "web" plugin on a chat completion (uses the LLM
 *   key, so LLM_PROVIDER must be "openrouter"); results are read from the
 *   `url_citation` annotations of the answer.
 *
 * Queries only contain company names / cities, never student data.
 * search() never throws: failures are logged with a code and return [].
 */
import { getLlmEnv, getWebSearchEnv } from "@/lib/env";
import { splitModelList } from "@/lib/llm/providers/openai";

export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  published?: string | null;
};

export interface WebSearchClient {
  search(query: string, opts?: { maxResults?: number }): Promise<WebResult[]>;
}

export const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
export const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;
const BRAVE_TIMEOUT_MS = 8_000;
const OPENROUTER_TIMEOUT_MS = 30_000;
const MAX_QUERY_CHARS = 200;
const MAX_SNIPPET_CHARS = 500;

type FetchLike = typeof fetch;

const clampResults = (n: number | undefined) =>
  Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(n ?? DEFAULT_MAX_RESULTS)));

const cleanQuery = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);

/** Removes tags / entities from provider snippets (Brave wraps hits in <strong>). */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function dedupe(results: WebResult[], max: number): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const r of results) {
    const key = r.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brave

type BraveResponse = {
  web?: {
    results?: {
      title?: unknown;
      url?: unknown;
      description?: unknown;
      page_age?: unknown;
      age?: unknown;
    }[];
  };
};

export function createBraveClient(opts: { apiKey: string; fetch?: FetchLike }): WebSearchClient {
  const fetchImpl: FetchLike = opts.fetch ?? ((...args) => fetch(...args));
  return {
    async search(query, searchOpts) {
      const q = cleanQuery(query);
      if (!q) return [];
      const max = clampResults(searchOpts?.maxResults);
      const url = new URL(BRAVE_ENDPOINT);
      url.searchParams.set("q", q);
      url.searchParams.set("count", String(max));
      url.searchParams.set("country", "fr");
      url.searchParams.set("search_lang", "fr");
      url.searchParams.set("safesearch", "moderate");
      try {
        const res = await fetchImpl(url.toString(), {
          headers: { Accept: "application/json", "X-Subscription-Token": opts.apiKey },
          signal: AbortSignal.timeout(BRAVE_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn(`[websearch] brave failed (http_${res.status})`);
          return [];
        }
        const body = (await res.json().catch(() => ({}))) as BraveResponse;
        const results: WebResult[] = [];
        for (const r of body.web?.results ?? []) {
          const link = httpUrl(r.url);
          if (!link) continue;
          results.push({
            title: typeof r.title === "string" ? stripHtml(r.title).slice(0, 300) : "",
            url: link,
            snippet:
              typeof r.description === "string"
                ? stripHtml(r.description).slice(0, MAX_SNIPPET_CHARS)
                : "",
            published:
              typeof r.page_age === "string"
                ? r.page_age
                : typeof r.age === "string"
                  ? r.age
                  : null,
          });
        }
        return dedupe(results, max);
      } catch (e) {
        console.warn(`[websearch] brave failed (${errorCode(e)})`);
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OpenRouter web plugin

type OpenRouterResponse = {
  choices?: {
    message?: {
      annotations?: {
        type?: unknown;
        url_citation?: { url?: unknown; title?: unknown; content?: unknown };
      }[];
    };
  }[];
};

export function createOpenRouterSearchClient(opts: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  appUrl?: string;
}): WebSearchClient {
  const fetchImpl: FetchLike = opts.fetch ?? ((...args) => fetch(...args));
  return {
    async search(query, searchOpts) {
      const q = cleanQuery(query);
      if (!q) return [];
      const max = clampResults(searchOpts?.maxResults);
      try {
        const res = await fetchImpl(OPENROUTER_CHAT_ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
            ...(opts.appUrl ? { "HTTP-Referer": opts.appUrl } : {}),
            "X-Title": "Spontane",
          },
          body: JSON.stringify({
            model: opts.model,
            plugins: [{ id: "web", max_results: max }],
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content: `Recherche sur le web : ${q}\nCite tes sources. Réponds en une phrase.`,
              },
            ],
          }),
        });
        if (!res.ok) {
          console.warn(`[websearch] openrouter failed (http_${res.status})`);
          return [];
        }
        const body = (await res.json().catch(() => ({}))) as OpenRouterResponse;
        const results: WebResult[] = [];
        for (const a of body.choices?.[0]?.message?.annotations ?? []) {
          if (a.type !== "url_citation" || !a.url_citation) continue;
          const link = httpUrl(a.url_citation.url);
          if (!link) continue;
          results.push({
            title:
              typeof a.url_citation.title === "string"
                ? stripHtml(a.url_citation.title).slice(0, 300)
                : "",
            url: link,
            snippet:
              typeof a.url_citation.content === "string"
                ? stripHtml(a.url_citation.content).slice(0, MAX_SNIPPET_CHARS)
                : "",
            published: null,
          });
        }
        return dedupe(results, max);
      } catch (e) {
        console.warn(`[websearch] openrouter failed (${errorCode(e)})`);
        return [];
      }
    },
  };
}

function errorCode(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
    return e.name || "error";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Factory

let warned = false;
const warnOnce = (msg: string) => {
  if (warned) return;
  warned = true;
  console.warn(msg);
};

/**
 * Client for WEBSEARCH_PROVIDER, or null when web search is disabled ("none")
 * or misconfigured (a warning naming the missing variable is logged once).
 */
export function getWebSearchClient(
  source: Record<string, string | undefined> = process.env,
  deps: { fetch?: FetchLike } = {},
): WebSearchClient | null {
  let provider: string;
  try {
    provider = getWebSearchEnv(source).WEBSEARCH_PROVIDER;
  } catch {
    warnOnce("[websearch] invalid WEBSEARCH_PROVIDER: web search disabled");
    return null;
  }
  if (provider === "brave") {
    const key = getWebSearchEnv(source).BRAVE_SEARCH_API_KEY;
    if (!key) {
      warnOnce("[websearch] BRAVE_SEARCH_API_KEY missing: web search disabled");
      return null;
    }
    return createBraveClient({ apiKey: key, fetch: deps.fetch });
  }
  if (provider === "openrouter") {
    try {
      const llm = getLlmEnv(source);
      if (llm.LLM_PROVIDER !== "openrouter") {
        warnOnce("[websearch] openrouter search requires LLM_PROVIDER=openrouter: disabled");
        return null;
      }
      const model = splitModelList(llm.LLM_MODEL_FAST)[0];
      if (!model) return null;
      return createOpenRouterSearchClient({
        apiKey: llm.LLM_API_KEY,
        model,
        fetch: deps.fetch,
        appUrl: source.APP_URL,
      });
    } catch {
      warnOnce("[websearch] LLM env incomplete: web search disabled");
      return null;
    }
  }
  return null;
}

/** Tests only: re-arm the one-time misconfiguration warning. */
export function resetWebSearchWarningsForTests(): void {
  warned = false;
}
