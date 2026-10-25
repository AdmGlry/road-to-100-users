/**
 * LIVE test: real calls to the API Recherche d'entreprises and the address API
 * (free, no key). Skipped unless LIVE_API=1:
 *
 *   LIVE_API=1 npx vitest run tests/live/hunter-search.live.test.ts
 *
 * Reference search (SPEC §7, Sprint 2): Business Analyst, alternance, Nantes, 30 km.
 * The LLM part runs only if LLM_API_KEY is also set.
 */
import { describe, expect, it } from "vitest";

import { fetchCandidates } from "@/lib/hunter/fetch-candidates";
import { fallbackNafCodes, mapRolesToNaf } from "@/lib/hunter/map-naf";
import { prefilterCompanies } from "@/lib/hunter/prefilter";
import { createCompaniesClient, normalizeCompany } from "@/lib/integrations/companies";
import { geocodeCity } from "@/lib/integrations/geocode";

const INPUT = { roles: ["Business Analyst"], sectors: [], skills: ["SQL"], degree: "Master MSI" };

describe.skipIf(process.env.LIVE_API !== "1")("hunter search (live API)", () => {
  it("finds at least 20 eligible companies around Nantes for a Business Analyst", async () => {
    const started = Date.now();
    const geo = await geocodeCity("Nantes");
    expect(geo).not.toBeNull();
    expect(geo!.departement).toBe("44");

    const naf = process.env.LLM_API_KEY
      ? (await mapRolesToNaf(INPUT)).codes
      : fallbackNafCodes(INPUT);
    const nafCodes = naf.map((c) => c.code);

    const client = createCompaniesClient();
    const origin = { lat: geo!.lat, lng: geo!.lng };
    const fetched = await fetchCandidates(client, {
      origin,
      departement: geo!.departement,
      radiusKm: 30,
      nafCodes,
      size: "any",
    });
    const companies = fetched.results.map((r) => normalizeCompany(r, origin));
    const pre = prefilterCompanies(companies, {
      radiusKm: 30,
      nafCodes,
      contractType: "alternance",
    });

    console.info(
      `[live] naf=${nafCodes.join(",")} fetched=${companies.length} requests=${fetched.requests} ` +
        `kept=${pre.kept.length} excluded=${JSON.stringify(pre.excluded)} in ${Date.now() - started} ms`,
    );
    expect(pre.kept.length).toBeGreaterThanOrEqual(20);
    for (const c of pre.kept) {
      expect(c.is_active).toBe(true);
      if (c.establishment?.distance_km != null) {
        expect(c.establishment.distance_km).toBeLessThanOrEqual(30);
      }
      expect(JSON.stringify(c.leaders)).not.toMatch(/naissance/);
    }
  }, 60_000);
});
