import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fallbackNafCodes, mapRolesToNaf, validateNafOutput } from "@/lib/hunter/map-naf";
import type { PrefilteredCompany } from "@/lib/hunter/prefilter";
import {
  applyScoreOutput,
  cleanReasons,
  clampScore,
  FALLBACK_REASON,
  scoreCompanies,
} from "@/lib/hunter/scoring";
import { setLlmProviderForTests, type LlmProvider } from "@/lib/llm/client";
import { buildMapNafPrompt, PROMPT_VERSION as MAP_NAF_VERSION } from "@/lib/llm/prompts/map-naf";
import {
  buildScoreFitPrompt,
  PROMPT_VERSION as SCORE_FIT_VERSION,
  type ScoreFitProfile,
} from "@/lib/llm/prompts/score-fit";

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_MODEL_FAST", "model-fast");
  vi.stubEnv("LLM_MODEL_SMART", "model-smart");
});
afterEach(() => {
  setLlmProviderForTests(undefined);
  vi.unstubAllEnvs();
});

function provider(reply: (prompt: string, call: number) => string) {
  const calls: { model: string; prompt: string; system?: string }[] = [];
  const p: LlmProvider = {
    async complete(req) {
      const prompt = req.messages[0].content;
      calls.push({ model: req.model, prompt, system: req.system });
      return { text: reply(prompt, calls.length), inputTokens: 100, outputTokens: 50 };
    },
  };
  return { provider: p, calls };
}

const BA_INPUT = {
  roles: ["Business Analyst"],
  sectors: ["Banque"],
  skills: ["SQL"],
  degree: "Master MSI",
};

describe("map_naf", () => {
  it("prompt contains the rules and a compact candidate list", () => {
    const { system, prompt } = buildMapNafPrompt({
      ...BA_INPUT,
      candidates: [{ code: "62.02A", label: "Conseil", division: "62", division_label: "x" }],
    });
    expect(MAP_NAF_VERSION).toBe("map_naf@1");
    expect(system).toMatch(/UNIQUEMENT dans la liste/);
    expect(prompt).toContain("62.02A | Conseil");
    expect(prompt).toContain("Business Analyst");
  });

  it("keeps valid codes in order, normalizes and drops unknown / duplicate codes", () => {
    const out = validateNafOutput({
      codes: [
        { code: "6202A", reason: "ESN" },
        { code: "99.99Z", reason: "inventé" },
        { code: "62.02A", reason: "doublon" },
        { code: "70.22z", reason: "Conseil" },
        { code: "n'importe quoi", reason: "" },
      ],
    });
    expect(out.map((c) => c.code)).toEqual(["62.02A", "70.22Z"]);
    expect(out[0].label).toMatch(/Conseil en systèmes/);
  });

  it("uses the model's codes when at least 2 are valid", async () => {
    const { provider: p, calls } = provider(() =>
      JSON.stringify({
        codes: [
          { code: "64.19Z", reason: "Banques" },
          { code: "62.02A", reason: "ESN" },
          { code: "12.34X", reason: "faux" },
        ],
      }),
    );
    const usage = vi.fn();
    const r = await mapRolesToNaf(BA_INPUT, { provider: p, onUsage: usage });
    expect(r.source).toBe("llm");
    expect(r.codes.map((c) => c.code)).toEqual(["64.19Z", "62.02A"]);
    expect(calls[0].model).toBe("model-fast");
    // ≤ 80 candidates in the prompt
    expect(calls[0].prompt.split("\n").filter((l) => / \| /.test(l)).length).toBeLessThanOrEqual(
      80,
    );
    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({ promptName: "map_naf", success: true }),
    );
  });

  it("falls back to the hint codes when fewer than 2 codes are valid", async () => {
    const { provider: p } = provider(() =>
      JSON.stringify({ codes: [{ code: "99.99Z", reason: "" }] }),
    );
    const r = await mapRolesToNaf(BA_INPUT, { provider: p });
    expect(r.source).toBe("fallback");
    expect(r.codes.map((c) => c.code).slice(0, 3)).toEqual(["62.02A", "62.01Z", "70.22Z"]);
  });

  it("falls back when the LLM fails", async () => {
    const failing: LlmProvider = {
      complete: async () => {
        throw new Error("503");
      },
    };
    const r = await mapRolesToNaf(BA_INPUT, { provider: failing });
    expect(r.source).toBe("fallback");
    expect(r.codes.length).toBeGreaterThanOrEqual(2);
    // Unknown role → generic codes
    const generic = fallbackNafCodes({ roles: ["Zzz"], sectors: [], skills: [], degree: null });
    expect(generic.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------

const PROFILE: ScoreFitProfile = {
  roles: ["Business Analyst"],
  sectors: ["Banque"],
  skills: ["SQL", "Power BI"],
  degree: "Master MSI",
  contract_type: "alternance",
  city: "Nantes",
  experience_titles: ["Stage assistant MOA"],
};

function candidates(count: number): PrefilteredCompany[] {
  return Array.from({ length: count }, (_, i) => ({
    siren: String(200000000 + i),
    name: `Société ${i}`,
    naf_code: "62.02A",
    naf_label: "Conseil en systèmes et logiciels informatiques",
    headcount_code: "12",
    headcount_label: "20 à 49 salariés",
    headcount_min: 20,
    category: "PME" as const,
    is_active: true,
    is_association: false,
    is_individual: false,
    leaders: [{ first_name: "Jean", last_name: "Dupont", role: "Président" }],
    raw_minimal: {},
    establishment: {
      siret: null,
      address: "1 rue X",
      postal_code: "44000",
      city: "NANTES",
      lat: null,
      lng: null,
      distance_km: 2,
    },
    prefilter_score: 50 + i,
  }));
}

const sirensIn = (prompt: string) => [...prompt.matchAll(/siren: (\d{9})/g)].map((m) => m[1]);

describe("score_fit", () => {
  it("prompt follows SPEC §7.2 and contains no personal contact data", () => {
    const { system, prompt } = buildScoreFitPrompt(PROFILE, [
      {
        siren: "200000000",
        name: "Société <<<x>>>",
        activity: "Conseil",
        headcount: "20 à 49 salariés",
        city: "NANTES",
      },
    ]);
    expect(SCORE_FIT_VERSION).toBe("score_fit@2");
    expect(system).toMatch(/Ne suppose aucune information/);
    expect(system).toMatch(/max 8 mots/);
    expect(prompt).toContain("siren: 200000000");
    expect(prompt).not.toContain("<<<x>>>");
    expect(prompt).not.toMatch(/@|\+33|06 /);
  });

  it("cleans reasons and clamps scores", () => {
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(72.6)).toBe(73);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(
      cleanReasons([
        "  un deux trois quatre cinq six sept huit neuf dix ",
        "",
        "ESN locale",
        "ESN locale",
        "Taille adaptée",
        "Quatrième raison",
      ]),
    ).toEqual(["un deux trois quatre cinq six sept huit", "ESN locale", "Taille adaptée"]);
  });

  it("ignores sirens outside the batch and falls back for missing ones", () => {
    const batch = candidates(3);
    const out = applyScoreOutput(batch, {
      results: [
        { siren: batch[0].siren, score: 150, reasons: ["ESN locale", "Taille adaptée"] },
        { siren: "999999999", score: 99, reasons: ["intrus"] },
        { siren: batch[1].siren, score: 40, reasons: [] },
      ],
    });
    expect(out.map((c) => c.siren)).toEqual(batch.map((c) => c.siren));
    expect(out[0]).toMatchObject({
      fit_score: 100,
      fit_source: "llm",
      fit_reasons: ["ESN locale", "Taille adaptée"],
    });
    expect(out[1]).toMatchObject({
      fit_score: 51,
      fit_source: "fallback",
      fit_reasons: [FALLBACK_REASON],
    });
    expect(out[2].fit_source).toBe("fallback");
  });

  it("scores in batches of 10 with max 3 in flight", async () => {
    let active = 0;
    let peak = 0;
    const calls: string[] = [];
    const p: LlmProvider = {
      async complete(req) {
        active++;
        peak = Math.max(peak, active);
        calls.push(req.messages[0].content);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        const sirens = sirensIn(req.messages[0].content);
        return {
          text: JSON.stringify({
            results: sirens.map((s, i) => ({
              siren: s,
              score: 60 + i,
              reasons: ["Raison une", "Raison deux"],
            })),
          }),
          inputTokens: 10,
          outputTokens: 10,
        };
      },
    };
    setLlmProviderForTests(p);
    const progress: [number, number][] = [];
    const { scored, failedBatches } = await scoreCompanies(PROFILE, candidates(25), {
      onBatchDone: (d, t) => {
        progress.push([d, t]);
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => sirensIn(c).length)).toEqual([10, 10, 5]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(scored).toHaveLength(25);
    expect(scored.every((c) => c.fit_source === "llm")).toBe(true);
    expect(failedBatches).toBe(0);
    expect(progress.map(([d]) => d)).toEqual([1, 2, 3]);
    expect(progress.every(([, t]) => t === 3)).toBe(true);
  });

  it("falls back to the prefilter score when a batch fails after 2 attempts", async () => {
    const { provider: p, calls } = provider((prompt) =>
      sirensIn(prompt)[0] === "200000000"
        ? "pas du JSON"
        : JSON.stringify({
            results: sirensIn(prompt).map((s) => ({
              siren: s,
              score: "80",
              reasons: ["Bon secteur", "Proche"],
            })),
          }),
    );
    const { scored, failedBatches } = await scoreCompanies(PROFILE, candidates(12), {
      provider: p,
    });
    expect(failedBatches).toBe(1);
    expect(calls).toHaveLength(3); // 2 attempts for the failing batch + 1
    const first = scored.slice(0, 10);
    expect(
      first.every((c) => c.fit_source === "fallback" && c.fit_reasons[0] === FALLBACK_REASON),
    ).toBe(true);
    expect(first[0].fit_score).toBe(50);
    expect(scored.slice(10).every((c) => c.fit_score === 80 && c.fit_source === "llm")).toBe(true);
  });
});
