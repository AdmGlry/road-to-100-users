/**
 * Company hook (SPEC §7.4 step 3). SERVER ONLY.
 *
 * With web search: ≤ 3 recent results → prompt `company_insight` (fast tier)
 * → one factual sentence + the URL of the result it comes from. The answer is
 * kept only if:
 *   - the URL is exactly one of the results (compared without trailing slash,
 *     case-insensitive host) — the stored URL is the result's own URL;
 *   - it is one sentence of ≤ 300 characters;
 *   - every number of the sentence appears in that result's title/snippet;
 *   - at least 40 % of its significant words (company name excluded) appear in
 *     that result (the sentence is drawn from the source, not invented).
 * Otherwise — or without web search, or on any error — a deterministic hook
 * built from the company's activity and city (kind "activity", no URL).
 * Never throws, never invents.
 */
import type { CompanyFacts, CompanyInsight } from "@/lib/hunter/application-types";
import { getWebSearchClient, type WebResult, type WebSearchClient } from "@/lib/integrations/websearch";
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildCompanyInsightPrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
} from "@/lib/llm/prompts/company-insight";
import { normalizeForMatch } from "@/lib/profile/grounding";

import { companyNameTokens } from "./domains";

export const INSIGHT_MAX_RESULTS = 3;
const INSIGHT_MAX_CHARS = 300;
const MIN_SOURCE_OVERLAP = 0.4;
const REGISTRY_HOST =
  /(^|\.)(societe\.com|pappers\.fr|pagesjaunes\.fr|verif\.com|infogreffe\.fr|data\.gouv\.fr|manageo\.fr|corporama\.com|kompass\.com|societeinfo\.com)$|indeed\.|linkedin\.|glassdoor\.|welcometothejungle\.|hellowork\./;

export type ResearchDeps = {
  /** undefined → from WEBSEARCH_PROVIDER; null → no web search. */
  webSearch?: WebSearchClient | null;
  provider?: LlmProvider;
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
};

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Deterministic, always-true hook: "ACME, spécialisée en conseil informatique, à Nantes." */
export function activityInsight(company: CompanyFacts): CompanyInsight {
  const name = company.name.trim();
  const activity = company.naf_label?.trim();
  const city = company.city?.trim();
  let text: string;
  if (activity && city) text = `${name} exerce dans le domaine « ${lowerFirst(activity)} » à ${city}.`;
  else if (activity) text = `${name} exerce dans le domaine « ${lowerFirst(activity)} ».`;
  else if (city) text = `${name} est une entreprise implantée à ${city}.`;
  else text = `${name} est une entreprise française.`;
  return { text, source_url: null, kind: "activity" };
}

function urlKey(url: string): string | null {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return null;
  }
}

const STOP = new Set(
  "les des une pour avec dans sur par aux est son ses ces qui que dont plus elle ils leur leurs vient vers cette".split(" "),
);

/** Validates the model's answer against the results; returns the hook or null. */
export function validateInsight(
  output: { insight: string | null; source_url: string | null },
  results: readonly WebResult[],
  companyName: string,
): CompanyInsight | null {
  const text = output.insight?.replace(/\s+/g, " ").trim() ?? "";
  if (!text || !output.source_url || text.length > INSIGHT_MAX_CHARS) return null;
  const key = urlKey(output.source_url);
  const source = key ? results.find((r) => urlKey(r.url) === key) : undefined;
  if (!source) return null;
  // One sentence: no sentence terminator before the end.
  if (/[.!?](\s+)\S/.test(text.replace(/\b(?:[A-Z]|St|Mr|Dr|cf|etc)\./g, "x"))) return null;
  const sourceText = normalizeForMatch(`${source.title} ${source.snippet}`);
  const sourceTokens = new Set(sourceText.split(" "));
  const numbers = normalizeForMatch(text).match(/\d+/g) ?? [];
  if (!numbers.every((n) => sourceTokens.has(n))) return null;
  const nameTokens = new Set(companyNameTokens(companyName));
  const words = normalizeForMatch(text)
    .split(" ")
    .filter((t) => t.length >= 4 && !/\d/.test(t) && !STOP.has(t) && !nameTokens.has(t));
  if (words.length > 0) {
    const hits = words.filter(
      (w) => sourceTokens.has(w) || sourceTokens.has(w.replace(/s$/, "")) || sourceTokens.has(`${w}s`),
    ).length;
    if (hits / words.length < MIN_SOURCE_OVERLAP) return null;
  }
  return { text: /[.!?]$/.test(text) ? text : `${text}.`, source_url: source.url, kind: "news" };
}

export async function findCompanyInsight(
  company: CompanyFacts,
  deps: ResearchDeps = {},
): Promise<CompanyInsight> {
  const fallback = activityInsight(company);
  const client = deps.webSearch === undefined ? getWebSearchClient() : deps.webSearch;
  if (!client) return fallback;
  try {
    const query = `"${company.name}"${company.city ? ` ${company.city}` : ""} actualité`;
    const raw = await client.search(query, { maxResults: INSIGHT_MAX_RESULTS + 2 });
    const results = raw
      .filter((r) => {
        try {
          const host = new URL(r.url).hostname.toLowerCase();
          // Registries / job boards say nothing usable; news media are fine.
          return !REGISTRY_HOST.test(host);
        } catch {
          return false;
        }
      })
      .slice(0, INSIGHT_MAX_RESULTS);
    if (results.length === 0) return fallback;
    const { system, prompt } = buildCompanyInsightPrompt({
      company: { name: company.name, activity: company.naf_label, city: company.city },
      results,
    });
    const { data } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: deps.provider,
      onUsage: deps.onUsage,
    });
    return validateInsight(data, results, company.name) ?? fallback;
  } catch (e) {
    console.warn(`[research] insight failed (${e instanceof Error ? e.name : "unknown"})`);
    return fallback;
  }
}
