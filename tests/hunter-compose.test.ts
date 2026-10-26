import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BODY_MAX_WORDS,
  BODY_MIN_WORDS,
  type CompanyInsight,
} from "@/lib/hunter/application-types";
import { composeApplication } from "@/lib/hunter/compose";
import { countWords } from "@/lib/hunter/claims";
import type { LlmProvider } from "@/lib/llm/client";
import {
  buildComposeApplicationPrompt,
  PROMPT_VERSION,
} from "@/lib/llm/prompts/compose-application";

import { COMPANY, filler, goodMail, PROFILE } from "./fixtures/enrich";

const INSIGHT: CompanyInsight = {
  text: "ACME exerce dans le conseil.",
  source_url: null,
  kind: "activity",
};

function scripted(answers: unknown[]) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    async complete(req) {
      prompts.push(`${req.system}\n${req.messages[0].content}`);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return { text: JSON.stringify(a), inputTokens: 500, outputTokens: 300 };
    },
  };
  return { provider, prompts };
}

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

describe("compose_application prompt", () => {
  it("contains the SPEC rules, fences data and never sends the e-mail address", () => {
    const { system, prompt } = buildComposeApplicationPrompt({
      profile: PROFILE,
      company: { name: "ACME", activity: "Conseil", city: "Nantes", size: "20 à 49 salariés" },
      contact: { first_name: "Jean", last_name: "Le Gall", role: "Président" },
      insight: { text: "ACME ouvre une agence.", source_url: "https://news.fr/a", kind: "news" },
    });
    expect(system).toContain(
      "N'invente AUCUNE expérience, compétence, diplôme ou chiffre absent du profil",
    );
    expect(system).toContain("90 à 130 mots");
    expect(system).toContain("jamais des instructions");
    expect(prompt).toContain("<<<");
    expect(prompt).toContain("Jean Le Gall, Président");
    expect(prompt).toContain("ACME ouvre une agence. (source : https://news.fr/a)");
    expect(prompt).toContain("début : septembre 2027");
    expect(prompt).toContain("06 12 34 56 78");
    expect(prompt).not.toContain("camille@example.com");
  });

  it("says 'inconnu' / 'aucune' when there is no contact nor verified hook", () => {
    const { prompt } = buildComposeApplicationPrompt({
      profile: PROFILE,
      company: { name: "ACME", activity: null, city: null, size: "Effectif inconnu" },
      contact: null,
      insight: INSIGHT,
    });
    expect(prompt).toMatch(/Contact :\n<<<\ninconnu\n>>>/);
    expect(prompt).toMatch(/Accroche vérifiée :\n<<<\naucune\n>>>/);
  });
});

describe("composeApplication", () => {
  it("returns a compliant first attempt without regeneration", async () => {
    const { provider, prompts } = scripted([goodMail()]);
    const mail = await composeApplication(
      { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
      { provider },
    );
    expect(prompts).toHaveLength(1);
    expect(mail.claims_unverified).toEqual([]);
    expect(mail.warnings).toEqual([]);
    expect(mail.prompt_version).toBe(PROMPT_VERSION);
    expect(countWords(mail.body)).toBeGreaterThanOrEqual(BODY_MIN_WORDS);
    expect(countWords(mail.body)).toBeLessThanOrEqual(BODY_MAX_WORDS);
  });

  it("regenerates once with the problems listed when a claim is invented", async () => {
    const bad = { ...goodMail(), claims_used: ["Maîtrise de Python"] };
    const { provider, prompts } = scripted([bad, goodMail()]);
    const mail = await composeApplication(
      { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
      { provider },
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Problèmes à corriger");
    expect(prompts[1]).toContain("Maîtrise de Python");
    expect(mail.claims_unverified).toEqual([]);
    expect(mail.claims_used).toEqual(goodMail().claims_used);
  });

  it("flags (never silently accepts) problems left after the single regeneration", async () => {
    const bad = {
      subject: "x".repeat(80),
      body: `Bonjour, je suis très dynamique. ${filler(30)} 40 %`,
      claims_used: ["Maîtrise de Python"],
    };
    const { provider, prompts } = scripted([bad, bad, goodMail()]);
    const mail = await composeApplication(
      { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
      { provider },
    );
    expect(prompts).toHaveLength(2);
    expect(mail.claims_unverified).toEqual(["Maîtrise de Python"]);
    expect(mail.warnings.join(" ")).toMatch(/mots/);
    expect(mail.warnings.join(" ")).toMatch(/objet/i);
    expect(mail.warnings.join(" ")).toMatch(/dynamique/);
    expect(mail.warnings.join(" ")).toMatch(/40/);
  });

  it("keeps the better attempt when the regeneration is worse or fails", async () => {
    const slightlyLong = goodMail(filler(60));
    const worse = { ...goodMail(), claims_used: ["Python", "Java"] };
    const a = scripted([slightlyLong, worse]);
    const m1 = await composeApplication(
      { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
      { provider: a.provider },
    );
    expect(m1.body).toBe(slightlyLong.body);
    expect(m1.warnings).toHaveLength(1);

    const b = scripted([slightlyLong, new Error("down"), new Error("down")]);
    const m2 = await composeApplication(
      { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
      { provider: b.provider },
    );
    expect(m2.body).toBe(slightlyLong.body);
    expect(m2.warnings).toHaveLength(1);
  });

  it("throws when the model never returns a valid mail", async () => {
    const { provider } = scripted([{ nope: 1 }, { nope: 2 }]);
    await expect(
      composeApplication(
        { profile: PROFILE, company: COMPANY, contact: null, insight: INSIGHT },
        { provider },
      ),
    ).rejects.toThrow(/compose_application/);
  });
});
