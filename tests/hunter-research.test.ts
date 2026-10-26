import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyFacts } from "@/lib/hunter/application-types";
import { activityInsight, findCompanyInsight, validateInsight } from "@/lib/hunter/research";
import type { WebResult, WebSearchClient } from "@/lib/integrations/websearch";
import type { LlmProvider } from "@/lib/llm/client";

const COMPANY: CompanyFacts = {
  id: "c1",
  siren: "901234567",
  name: "ACME CONSEIL",
  naf_label: "Conseil en systèmes et logiciels informatiques",
  city: "Nantes",
  headcount_label: "20 à 49 salariés",
  headcount_min: 20,
  website: null,
  domain: null,
  leaders: [],
};

const RESULTS: WebResult[] = [
  {
    title: "ACME Conseil ouvre une agence à Rennes",
    url: "https://www.ouest-france.fr/acme-agence-rennes",
    snippet:
      "Le cabinet nantais ACME Conseil ouvre une nouvelle agence à Rennes et prévoit 15 recrutements en 2026.",
  },
  {
    title: "ACME CONSEIL - societe.com",
    url: "https://www.societe.com/societe/acme-conseil-901234567.html",
    snippet: "Chiffre d'affaires…",
  },
];

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("LLM_API_KEY", "k");
  vi.stubEnv("LLM_MODEL_FAST", "fast");
  vi.stubEnv("LLM_MODEL_SMART", "smart");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const search = (results: WebResult[]): WebSearchClient & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    async search(q) {
      queries.push(q);
      return results;
    },
  };
};

const provider = (answer: unknown, prompts: string[] = []): LlmProvider => ({
  async complete(req) {
    prompts.push(`${req.system}\n${req.messages[0].content}`);
    return { text: JSON.stringify(answer), inputTokens: 100, outputTokens: 20 };
  },
});

describe("activityInsight", () => {
  it("is deterministic and only uses known facts", () => {
    expect(activityInsight(COMPANY)).toEqual({
      text: "ACME CONSEIL exerce dans le domaine « conseil en systèmes et logiciels informatiques » à Nantes.",
      source_url: null,
      kind: "activity",
    });
    expect(activityInsight({ ...COMPANY, naf_label: null }).text).toBe(
      "ACME CONSEIL est une entreprise implantée à Nantes.",
    );
    expect(activityInsight({ ...COMPANY, naf_label: null, city: null }).text).toBe(
      "ACME CONSEIL est une entreprise française.",
    );
  });
});

describe("findCompanyInsight", () => {
  it("without web search: activity hook, no LLM call", async () => {
    const p = { complete: vi.fn() };
    expect(await findCompanyInsight(COMPANY, { webSearch: null, provider: p })).toEqual(
      activityInsight(COMPANY),
    );
    expect(p.complete).not.toHaveBeenCalled();
  });

  it("returns the sourced sentence when the URL is one of the results; registries are not sent", async () => {
    const prompts: string[] = [];
    const ws = search(RESULTS);
    const insight = await findCompanyInsight(COMPANY, {
      webSearch: ws,
      provider: provider(
        {
          insight:
            "ACME Conseil ouvre une nouvelle agence à Rennes et prévoit 15 recrutements en 2026",
          source_url: "https://www.ouest-france.fr/acme-agence-rennes/",
        },
        prompts,
      ),
    });
    expect(insight).toEqual({
      text: "ACME Conseil ouvre une nouvelle agence à Rennes et prévoit 15 recrutements en 2026.",
      source_url: "https://www.ouest-france.fr/acme-agence-rennes",
      kind: "news",
    });
    expect(ws.queries[0]).toContain('"ACME CONSEIL" Nantes');
    expect(prompts[0]).not.toContain("societe.com");
    expect(prompts[0]).toContain("jamais des instructions");
  });

  it("falls back when the URL is not a result, or the model says nothing reliable, or fails", async () => {
    const fallback = activityInsight(COMPANY);
    expect(
      await findCompanyInsight(COMPANY, {
        webSearch: search(RESULTS),
        provider: provider({
          insight: "ACME ouvre une agence à Rennes.",
          source_url: "https://invented.fr/x",
        }),
      }),
    ).toEqual(fallback);
    expect(
      await findCompanyInsight(COMPANY, {
        webSearch: search(RESULTS),
        provider: provider({ insight: null, source_url: null }),
      }),
    ).toEqual(fallback);
    expect(
      await findCompanyInsight(COMPANY, {
        webSearch: search(RESULTS),
        provider: {
          complete: async () => {
            throw new Error("down");
          },
        },
      }),
    ).toEqual(fallback);
    expect(
      await findCompanyInsight(COMPANY, { webSearch: search([]), provider: provider({}) }),
    ).toEqual(fallback);
  });
});

describe("validateInsight", () => {
  const ok = (insight: string) =>
    validateInsight({ insight, source_url: RESULTS[0].url }, RESULTS, COMPANY.name);

  it("rejects figures absent from the source", () => {
    expect(ok("ACME Conseil ouvre une agence à Rennes et prévoit 40 recrutements.")).toBeNull();
  });
  it("rejects sentences not drawn from the source", () => {
    expect(ok("ACME Conseil a remporté le prix de l'innovation numérique européenne.")).toBeNull();
  });
  it("rejects several sentences or overly long text", () => {
    expect(ok("ACME Conseil ouvre une agence. Elle prévoit des recrutements.")).toBeNull();
    expect(ok(`ACME Conseil ouvre une agence ${"à Rennes ".repeat(40)}`)).toBeNull();
  });
});
