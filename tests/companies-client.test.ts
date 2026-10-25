import { describe, expect, it, vi } from "vitest";

import {
  buildQuery,
  CompaniesApiError,
  createCompaniesClient,
  isManagerialRole,
  normalizeCompany,
  normalizeLeaders,
  parseCompaniesResponse,
  RateLimiter,
} from "@/lib/integrations/companies";

import { NANTES, readCompaniesFixture } from "./fixtures/companies";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const noSleep = async () => {};

function client(fetchImpl: typeof fetch) {
  return createCompaniesClient({ fetch: fetchImpl, sleep: noSleep, minIntervalMs: 0 });
}

describe("buildQuery", () => {
  it("joins arrays, stringifies booleans and skips empty values", () => {
    expect(
      buildQuery({
        activite_principale: ["62.02A", "70.22Z"],
        minimal: true,
        page: 2,
        q: "",
        departement: [],
        include: undefined,
        x: null,
      }),
    ).toBe("activite_principale=62.02A%2C70.22Z&minimal=true&page=2");
  });
});

describe("companies client", () => {
  it("calls /near_point with the expected parameters and parses the response", async () => {
    const fetchMock = vi.fn(async () => json(readCompaniesFixture("near-point-nantes")));
    const page = await client(fetchMock as unknown as typeof fetch).searchNearPoint({
      lat: 47.2173,
      long: -1.5534,
      radius: 30,
      activite_principale: ["62.02A", "70.22Z"],
      limite_matching_etablissements: 5,
      page: 1,
      per_page: 100,
    });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://recherche-entreprises.api.gouv.fr/near_point");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "47.2173",
      long: "-1.5534",
      radius: "30",
      activite_principale: "62.02A,70.22Z",
      limite_matching_etablissements: "5",
      page: "1",
      per_page: "25", // capped
    });
    // 8 raw results, the one without siren is dropped
    expect(page.results).toHaveLength(7);
    expect(page.total_pages).toBe(1);
    const alpha = page.results[0];
    expect(alpha.matching_etablissements[0].latitude).toBe(47.2133); // string → number
    expect(alpha.complements?.est_entrepreneur_individuel).toBe(false);
  });

  it("calls /search with filters", async () => {
    const fetchMock = vi.fn(async () => json(readCompaniesFixture("search-departement-44")));
    await client(fetchMock as unknown as typeof fetch).searchCompanies({
      activite_principale: ["62.01Z"],
      departement: ["44"],
      etat_administratif: "A",
      tranche_effectif_salarie: ["11", "12"],
    });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("departement")).toBe("44");
    expect(url.searchParams.get("etat_administratif")).toBe("A");
    expect(url.searchParams.get("tranche_effectif_salarie")).toBe("11,12");
    expect(url.searchParams.get("per_page")).toBe("25");
  });

  it("retries on HTTP 429 with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        json({ results: [], total_results: 0, page: 1, per_page: 25, total_pages: 0 }),
      );
    const c = createCompaniesClient({
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      minIntervalMs: 0,
    });
    const page = await c.searchNearPoint({ lat: 47, long: -1, radius: 10 });
    expect(page.results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([600, 1800]);
  });

  it("gives up after 2 retries on 429", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    await expect(
      client(fetchMock as unknown as typeof fetch).searchNearPoint({
        lat: 47,
        long: -1,
        radius: 10,
      }),
    ).rejects.toMatchObject({ name: "CompaniesApiError", code: "rate_limited", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry HTTP 400 and exposes the API message", async () => {
    const fetchMock = vi.fn(async () =>
      json({ erreur: "Veuillez indiquer un code NAF valide." }, 400),
    );
    const err = await client(fetchMock as unknown as typeof fetch)
      .searchCompanies({ activite_principale: ["99.99Z"] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompaniesApiError);
    expect(err).toMatchObject({ code: "bad_request", status: 400 });
    expect((err as Error).message).toContain("code NAF valide");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network errors and timeouts", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      client(failing as unknown as typeof fetch).searchNearPoint({ lat: 47, long: -1, radius: 5 }),
    ).rejects.toMatchObject({ code: "network" });
    expect(failing).toHaveBeenCalledTimes(3);

    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const c = createCompaniesClient({
      fetch: hanging as unknown as typeof fetch,
      sleep: noSleep,
      minIntervalMs: 0,
      timeoutMs: 5,
      maxRetries: 0,
    });
    await expect(c.searchNearPoint({ lat: 47, long: -1, radius: 5 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("rejects non-JSON bodies", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(
      client(fetchMock as unknown as typeof fetch).searchNearPoint({
        lat: 47,
        long: -1,
        radius: 5,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("limits concurrency and spaces request starts", async () => {
    let t = 0;
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    const limiter = new RateLimiter(
      200,
      3,
      async (ms) => {
        t += ms;
      },
      () => t,
    );
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          starts.push(t);
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(0);
    }
    // 6 requests at ≥200 ms spacing → the last one starts ≥ 1000 ms after the first.
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThanOrEqual(1000);
  });
});

describe("normalizeCompany", () => {
  const page = parseCompaniesResponse(readCompaniesFixture("near-point-nantes"));
  const bySiren = (s: string) => page.results.find((r) => r.siren === s)!;

  it("normalizes a PME with leaders and no birth dates", () => {
    const c = normalizeCompany(bySiren("901234567"), NANTES);
    expect(c).toMatchObject({
      siren: "901234567",
      name: "ALPHA CONSEIL (ALPHA)",
      naf_code: "70.22Z",
      headcount_code: "12",
      headcount_label: "20 à 49 salariés",
      headcount_min: 20,
      category: "PME",
      is_active: true,
      is_association: false,
      is_individual: false,
    });
    expect(c.naf_label).toMatch(/Conseil pour les affaires/);
    expect(c.leaders).toEqual([
      { first_name: "Jean-Pierre", last_name: "Dupont", role: "Président" },
      { first_name: "Anne", last_name: "Le Gall", role: "Directeur général délégué" },
    ]);
    const serialized = JSON.stringify(c);
    expect(serialized).not.toMatch(/naissance|1970|Française|MARTIN|AUDIT ET CO/);
    expect(c.raw_minimal).not.toHaveProperty("dirigeants");
    expect(c.raw_minimal).not.toHaveProperty("finances");
    expect(c.establishment).toMatchObject({
      siret: "90123456700011",
      city: "NANTES",
      postal_code: "44000",
      lat: 47.2133,
      lng: -1.5612,
    });
    expect(c.establishment!.distance_km).toBeGreaterThan(0.3);
    expect(c.establishment!.distance_km).toBeLessThan(1);
  });

  it("picks the nearest matching establishment, not the HQ", () => {
    const c = normalizeCompany(bySiren("552000001"), NANTES);
    expect(c.category).toBe("GE");
    expect(c.establishment?.siret).toBe("55200000100420");
    expect(c.establishment?.address).toBe("16 MAIL PABLO PICASSO 44000 NANTES");
    expect(c.establishment!.distance_km).toBeLessThan(2);
    expect(c.leaders).toEqual([
      { first_name: "Paul", last_name: "Durand", role: "Directeur Général" },
    ]);
  });

  it("without origin, keeps the first establishment and no distance", () => {
    const c = normalizeCompany(bySiren("552000001"));
    expect(c.establishment?.siret).toBe("55200000100500");
    expect(c.establishment?.distance_km).toBeNull();
  });

  it("flags closed companies, individual entrepreneurs and unknown sizes", () => {
    expect(normalizeCompany(bySiren("812345678")).is_active).toBe(false);
    const ei = normalizeCompany(bySiren("823456789"));
    expect(ei.is_individual).toBe(true);
    expect(ei.headcount_code).toBeNull();
    expect(ei.headcount_label).toBe("Effectif inconnu");
    const unknown = normalizeCompany(bySiren("834567890"), NANTES);
    expect(unknown.headcount_min).toBeNull();
    expect(unknown.category).toBeNull();
    expect(unknown.establishment?.lat).toBe(47.2105); // numeric lat/lng accepted too
  });

  it("falls back to the siege when there is no matching establishment", () => {
    const [r] = parseCompaniesResponse({
      results: [
        {
          siren: "999999999",
          nom_complet: "SIEGE ONLY",
          etat_administratif: "A",
          siege: { siret: "99999999900011", coordonnees: "47.2,-1.55", libelle_commune: "NANTES" },
        },
      ],
    }).results;
    const c = normalizeCompany(r, NANTES);
    expect(c.establishment).toMatchObject({ siret: "99999999900011", lat: 47.2, lng: -1.55 });
    expect(c.leaders).toEqual([]);
  });
});

describe("leaders filtering", () => {
  it("keeps managerial natural persons only", () => {
    expect(isManagerialRole("Président")).toBe(true);
    expect(isManagerialRole("Gérant")).toBe(true);
    expect(isManagerialRole("Directeur général délégué")).toBe(true);
    expect(isManagerialRole("Président du conseil d'administration")).toBe(true);
    expect(isManagerialRole("Commissaire aux comptes suppléant")).toBe(false);
    expect(isManagerialRole("Commissaire aux comptes titulaire")).toBe(false);
    expect(isManagerialRole("Administrateur")).toBe(false);
    expect(isManagerialRole("Membre du conseil de surveillance")).toBe(false);
    expect(isManagerialRole(null)).toBe(false);
    expect(
      normalizeLeaders([
        { nom: "X", prenoms: "Y", qualite: "Président", type_dirigeant: "personne morale" },
        {
          nom: "DE LA ROCHE",
          prenoms: "ÉLODIE ANNE",
          qualite: "Gérant",
          type_dirigeant: "personne physique",
        },
        {
          nom: "DE LA ROCHE",
          prenoms: "ÉLODIE",
          qualite: "Co-gérant",
          type_dirigeant: "personne physique",
        },
        { nom: null, prenoms: "SANS NOM", qualite: "Gérant", type_dirigeant: "personne physique" },
      ]),
    ).toEqual([{ first_name: "Élodie", last_name: "De La Roche", role: "Gérant" }]);
  });
});
