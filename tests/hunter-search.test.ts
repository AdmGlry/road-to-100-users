import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSearchStatus,
  HunterError,
  listLeads,
  runSearch,
  setLeadStatus,
  startSearch,
  type HunterSearchParams,
} from "@/lib/hunter/search";
import { createCompaniesClient } from "@/lib/integrations/companies";
import type { GeocodeResult } from "@/lib/integrations/geocode";
import type { LlmProvider } from "@/lib/llm/client";

import { readCompaniesFixture } from "./fixtures/companies";
import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const CONTACTED_COMPANY = "c0c0c0c0-0000-4000-8000-000000000001";

const PARAMS: HunterSearchParams = {
  roles: ["Business Analyst"],
  sectors: ["Banque"],
  city: "Nantes",
  radius_km: 30,
  contract_type: "alternance",
  size: "any",
};

const NANTES_GEO: GeocodeResult = {
  lat: 47.2173,
  lng: -1.5534,
  city: "Nantes",
  postcode: "44000",
  departement: "44",
};

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_MODEL_FAST", "model-fast");
  vi.stubEnv("LLM_MODEL_SMART", "model-smart");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setup(opts: { contacted?: boolean } = {}) {
  const shared: Record<string, Record<string, unknown>[]> = {};
  const user = createFakeSupabase(
    {
      profiles: [
        {
          user_id: USER,
          full_name: "Camille Etudiante",
          email: "camille@example.com",
          phone: "06 12 34 56 78",
          city: "Nantes",
          degree: "Master MSI",
          skills: ["SQL", "Power BI"],
          experiences: [
            {
              title: "Stage assistant MOA",
              company: "Banque X",
              start: null,
              end: null,
              bullets: [],
            },
          ],
          target_roles: ["Business Analyst"],
          target_sectors: [],
          search_radius_km: 30,
        },
      ],
      companies: opts.contacted
        ? [{ id: CONTACTED_COMPANY, siren: "901234567", name: "ALPHA CONSEIL" }]
        : [],
      leads: opts.contacted
        ? [
            {
              id: "1e1e1e1e-0000-4000-8000-000000000001",
              user_id: USER,
              search_id: null,
              company_id: CONTACTED_COMPANY,
              status: "sent",
            },
          ]
        : [],
      applications: [],
    },
    { tables: shared },
  );
  const admin = createFakeSupabase({}, { tables: shared });
  return { user, admin, shared };
}

function fakeFetch(handler?: (url: URL) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (handler) return handler(url);
    if (url.pathname === "/near_point") {
      return new Response(JSON.stringify(readCompaniesFixture("near-point-nantes")));
    }
    if (url.pathname === "/search") {
      return new Response(JSON.stringify(readCompaniesFixture("search-departement-44")));
    }
    return new Response("", { status: 404 });
  });
}

const sirensIn = (prompt: string) => [...prompt.matchAll(/siren: (\d{9})/g)].map((m) => m[1]);

function llm(opts: { fail?: boolean } = {}) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    async complete(req) {
      const prompt = req.messages[0].content;
      prompts.push(`${req.system}\n${prompt}`);
      if (opts.fail) throw new Error("provider down");
      if (req.system?.includes("codes NAF")) {
        return {
          text: JSON.stringify({
            codes: [
              { code: "62.02A", reason: "ESN" },
              { code: "70.22Z", reason: "Conseil" },
              { code: "64.19Z", reason: "Banque" },
              { code: "62.01Z", reason: "Dev" },
            ],
          }),
          inputTokens: 300,
          outputTokens: 40,
        };
      }
      const results = sirensIn(prompt).map((siren, i) => ({
        siren,
        score: siren === "856789012" ? 95 : 70 - i,
        reasons: ["Secteur bancaire visé", "Taille adaptée"],
      }));
      return { text: JSON.stringify({ results }), inputTokens: 500, outputTokens: 120 };
    },
  };
  return { provider, prompts };
}

function deps(
  fetchMock: ReturnType<typeof vi.fn>,
  provider: LlmProvider,
  geo: GeocodeResult | null = NANTES_GEO,
) {
  return {
    companiesClient: createCompaniesClient({
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => {},
      minIntervalMs: 0,
      maxRetries: 0,
    }),
    geocode: async () => geo,
    llmProvider: provider,
  };
}

describe("startSearch", () => {
  it("validates params and creates a running search", async () => {
    const { user } = setup();
    const id = await startSearch(user.client, USER, PARAMS);
    const row = user.tables.searches.find((s) => s.id === id)!;
    expect(row).toMatchObject({
      user_id: USER,
      status: "running",
      params: PARAMS,
      progress: { step: "naf", done: 0, total: 1 },
    });

    const err = await startSearch(user.client, USER, { ...PARAMS, roles: [], sectors: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HunterError);
    expect((err as HunterError).userMessage).toMatch(/au moins un rôle/);
  });
});

describe("runSearch", () => {
  it("creates leads, writes companies with the admin client and reports progress", async () => {
    const { user, admin, shared } = setup({ contacted: true });
    const fetchMock = fakeFetch();
    const { provider, prompts } = llm();
    const id = await startSearch(user.client, USER, PARAMS);
    const progressSteps: string[] = [];
    const origFrom = user.client.from.bind(user.client);
    (user.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = origFrom(t) as unknown as { update: (p: Record<string, unknown>) => unknown };
      if (t === "searches") {
        const update = q.update.bind(q);
        q.update = (p) => {
          const step = (p.progress as { step?: string } | undefined)?.step;
          if (step && progressSteps.at(-1) !== step) progressSteps.push(step);
          return update(p);
        };
      }
      return q;
    };

    const result = await runSearch(user.client, admin.client, id, USER, deps(fetchMock, provider));
    expect(result).toEqual({ status: "done", resultsCount: 3 });

    // near_point with the validated NAF codes, then /search on the département (< 60 results)
    const urls = fetchMock.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    expect(urls[0].pathname).toBe("/near_point");
    expect(urls[0].searchParams.get("activite_principale")).toBe("62.02A,70.22Z,64.19Z,62.01Z");
    expect(urls[0].searchParams.get("radius")).toBe("30");
    expect(urls[1].pathname).toBe("/search");
    expect(urls[1].searchParams.get("departement")).toBe("44");

    // companies only written by the service-role client
    expect(user.calls.some((c) => c.table === "companies" && c.op !== "select")).toBe(false);
    const companyUpsert = admin.calls.find((c) => c.table === "companies" && c.op === "upsert")!;
    expect(companyUpsert.options).toMatchObject({ onConflict: "siren" });
    const cache = shared.companies.filter((c) => c.siren !== "901234567");
    expect(cache.map((c) => c.siren).sort()).toEqual(["552000001", "845678901", "856789012"]);
    const ggsn = shared.companies.find((c) => c.siren === "552000001")!;
    expect(ggsn).toMatchObject({ city: "NANTES", headcount_range: "53", naf_code: "62.02A" });
    expect(JSON.stringify(ggsn)).not.toMatch(/naissance|PETIT/);

    // leads: closed, EI, unknown size, contacted (sent) and too-far companies excluded
    const leads = shared.leads.filter((l) => l.search_id === id);
    expect(leads).toHaveLength(3);
    expect(shared.leads.filter((l) => l.company_id === CONTACTED_COMPANY)).toHaveLength(1);
    const bank = leads.find(
      (l) => l.company_id === shared.companies.find((c) => c.siren === "856789012")!.id,
    )!;
    expect(bank).toMatchObject({
      user_id: USER,
      status: "suggested",
      fit_score: 95,
      fit_reasons: ["Secteur bancaire visé", "Taille adaptée"],
      establishment_city: "NANTES",
      establishment_siret: "85678901200016",
    });
    expect(bank.distance_km as number).toBeGreaterThan(3);
    expect(bank.prefilter_score as number).toBeGreaterThan(0);

    // search row
    const search = shared.searches.find((s) => s.id === id)!;
    expect(search).toMatchObject({
      status: "done",
      results_count: 3,
      error: null,
      progress: { step: "done", done: 3, total: 3 },
    });
    expect((search.params as Record<string, unknown>).naf_codes).toEqual([
      "62.02A",
      "70.22Z",
      "64.19Z",
      "62.01Z",
    ]);
    expect(progressSteps).toEqual(["naf", "fetch", "prefilter", "scoring", "done"]);

    // events
    const events = shared.events.map((e) => e.name);
    expect(events).toEqual(expect.arrayContaining(["search_started", "search_done", "llm_usage"]));
    const done = shared.events.find((e) => e.name === "search_done")!;
    expect(done.props).toMatchObject({ results_count: 3, naf_count: 4 });
    expect(typeof (done.props as Record<string, unknown>).duration_ms).toBe("number");
    expect(shared.events.filter((e) => e.name === "llm_usage")).toHaveLength(2);

    // No contact data of the student sent to the LLM
    for (const p of prompts) {
      expect(p).not.toContain("camille@example.com");
      expect(p).not.toContain("06 12 34 56 78");
      expect(p).not.toContain("Camille");
    }

    // Read side
    const cards = await listLeads(user.client, USER, id);
    expect(cards.map((c) => c.siren)).toEqual(["856789012", "552000001", "845678901"]);
    expect(cards[0]).toMatchObject({
      name: "BANQUE REGIONALE DE L'OUEST",
      headcount_label: "500 à 999 salariés",
      size: "large",
      city: "NANTES",
      status: "suggested",
    });
    expect(cards[0].naf_label).toMatch(/intermédiations monétaires/);
    expect((await listLeads(user.client, USER, id, { size: "small" })).map((c) => c.siren)).toEqual(
      ["845678901"],
    );
    expect((await listLeads(user.client, USER, id, { minScore: 90 })).map((c) => c.siren)).toEqual([
      "856789012",
    ]);
    const near = await listLeads(user.client, USER, id, { maxDistanceKm: 2 });
    expect(near.every((c) => (c.distance_km ?? 99) <= 2)).toBe(true);

    const status = await getSearchStatus(user.client, id);
    expect(status).toMatchObject({ id, status: "done", results_count: 3, error: null });
    expect(await getSearchStatus(user.client, "5e5e5e5e-0000-4000-8000-000000000000")).toBeNull();
  });

  it("is idempotent: re-running does not duplicate leads and keeps their status", async () => {
    const { user, admin, shared } = setup();
    const { provider } = llm();
    const id = await startSearch(user.client, USER, PARAMS);
    await runSearch(user.client, admin.client, id, USER, deps(fakeFetch(), provider));
    const first = shared.leads.length;
    expect(first).toBe(4); // ALPHA is not contacted here
    const someLead = shared.leads[0];
    expect(await setLeadStatus(user.client, USER, [someLead.id as string], "selected")).toBe(1);

    const again = await runSearch(user.client, admin.client, id, USER, deps(fakeFetch(), provider));
    expect(again).toEqual({ status: "done", resultsCount: 4 });
    expect(shared.leads).toHaveLength(first);
    expect(shared.companies).toHaveLength(4);
    expect(shared.leads.find((l) => l.id === someLead.id)!.status).toBe("selected");
  });

  it("setLeadStatus never touches drafted/sent leads and validates input", async () => {
    const { user, shared } = setup({ contacted: true });
    const sent = shared.leads[0].id as string;
    expect(await setLeadStatus(user.client, USER, [sent], "dismissed")).toBe(0);
    expect(shared.leads[0].status).toBe("sent");
    await expect(
      setLeadStatus(user.client, USER, ["not-a-uuid"], "selected"),
    ).rejects.toBeInstanceOf(HunterError);
    await expect(
      setLeadStatus(user.client, USER, [sent], "sent" as unknown as "selected"),
    ).rejects.toBeInstanceOf(HunterError);
  });

  it("fails clearly without the service-role key, before calling any API", async () => {
    const { user, shared } = setup();
    const fetchMock = fakeFetch();
    const { provider, prompts } = llm();
    const id = await startSearch(user.client, USER, PARAMS);
    const r = await runSearch(user.client, null, id, USER, deps(fetchMock, provider));
    expect(r).toMatchObject({ status: "failed", code: "missing_service_role" });
    expect((r as { error: string }).error).toMatch(/^Configuration serveur incomplète/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
    expect(shared.searches[0]).toMatchObject({ status: "failed" });
    expect(shared.searches[0].error).toMatch(/Configuration serveur incomplète/);
    expect(console.error).toHaveBeenCalledWith("[hunter] search failed: missing_service_role");
  });

  it("creates the admin client from the env when not given, and fails if the key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    const { user } = setup();
    const id = await startSearch(user.client, USER, PARAMS);
    const r = await runSearch(user.client, undefined, id, USER, deps(fakeFetch(), llm().provider));
    expect(r).toMatchObject({ status: "failed", code: "missing_service_role" });
  });

  it("marks the search failed when the companies API is down", async () => {
    const { user, admin, shared } = setup();
    const fetchMock = fakeFetch(() => new Response("", { status: 503 }));
    const id = await startSearch(user.client, USER, PARAMS);
    const r = await runSearch(user.client, admin.client, id, USER, deps(fetchMock, llm().provider));
    expect(r).toMatchObject({ status: "failed", code: "api_unavailable" });
    const search = shared.searches[0];
    expect(search.status).toBe("failed");
    expect(search.error).toMatch(/ne répond pas/);
    expect((search.progress as { step: string }).step).toBe("fetch");
    expect(shared.leads).toHaveLength(0);
    expect(shared.events.find((e) => e.name === "search_failed")!.props).toMatchObject({
      code: "api_unavailable",
      step: "fetch",
    });
  });

  it("fails with a French message when the city cannot be located", async () => {
    const { user, admin, shared } = setup();
    const fetchMock = fakeFetch();
    const id = await startSearch(user.client, USER, { ...PARAMS, city: "Nulle-Part" });
    const r = await runSearch(
      user.client,
      admin.client,
      id,
      USER,
      deps(fetchMock, llm().provider, null),
    );
    expect(r).toMatchObject({ status: "failed", code: "geocode_failed" });
    expect(shared.searches[0].error).toMatch(/Impossible de localiser ta ville/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to /search by département when geocoding fails but a postcode is known", async () => {
    const { user, admin, shared } = setup();
    const fetchMock = fakeFetch();
    const id = await startSearch(user.client, USER, { ...PARAMS, city: "44000 Nantes" });
    const r = await runSearch(
      user.client,
      admin.client,
      id,
      USER,
      deps(fetchMock, llm().provider, null),
    );
    expect(r.status).toBe("done");
    const urls = fetchMock.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    expect(urls.map((u) => u.pathname)).toEqual(["/search"]);
    expect(urls[0].searchParams.get("departement")).toBe("44");
    // no distance known → nothing excluded as too far
    expect(shared.leads).toHaveLength(2);
    expect(shared.leads.every((l) => l.distance_km === null)).toBe(true);
  });

  it("still completes with deterministic fallbacks when the LLM is down", async () => {
    const { user, admin, shared } = setup();
    const id = await startSearch(user.client, USER, PARAMS);
    const r = await runSearch(
      user.client,
      admin.client,
      id,
      USER,
      deps(fakeFetch(), llm({ fail: true }).provider),
    );
    expect(r).toEqual({ status: "done", resultsCount: 4 });
    expect(
      shared.leads.every(
        (l) => (l.fit_reasons as string[])[0] === "Score estimé (IA indisponible)",
      ),
    ).toBe(true);
    expect((shared.searches[0].params as { naf_source: string }).naf_source).toBe("fallback");
    expect(shared.events.find((e) => e.name === "search_done")!.props).toMatchObject({
      llm_failed_batches: 1,
    });
  });

  it("fails when the leads write fails, without throwing", async () => {
    const shared: Record<string, Record<string, unknown>[]> = {};
    const user = createFakeSupabase(
      { profiles: [{ user_id: USER, skills: [] }] },
      {
        tables: shared,
        failOn: (t, op) =>
          t === "leads" && op === "upsert" ? { code: "42501", message: "rls" } : null,
      },
    );
    const admin = createFakeSupabase({}, { tables: shared });
    const id = await startSearch(user.client, USER, PARAMS);
    const r = await runSearch(
      user.client,
      admin.client,
      id,
      USER,
      deps(fakeFetch(), llm().provider),
    );
    expect(r).toMatchObject({ status: "failed", code: "database" });
    expect(shared.searches[0].status).toBe("failed");
  });

  it("returns failed for an unknown search id without writing", async () => {
    const { user, admin, shared } = setup();
    const r = await runSearch(
      user.client,
      admin.client,
      "5e5e5e5e-0000-4000-8000-000000000000",
      USER,
      deps(fakeFetch(), llm().provider),
    );
    expect(r).toMatchObject({ status: "failed", code: "search_not_found" });
    expect(shared.searches ?? []).toHaveLength(0);
  });
});
