import { describe, expect, it, vi } from "vitest";

import {
  departementFromPostcode,
  extractPostcode,
  geocodeCity,
  GEOCODE_URLS,
  isPlausibleMatch,
} from "@/lib/integrations/geocode";

import { readCompaniesFixture } from "./fixtures/companies";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("geocodeCity", () => {
  it("returns lat/lng, city, postcode and département", async () => {
    const fetchMock = vi.fn(async () => json(readCompaniesFixture("geocode-nantes")));
    const r = await geocodeCity("Nantes", { fetch: fetchMock as unknown as typeof fetch });
    expect(r).toEqual({
      lat: 47.2173,
      lng: -1.5534,
      city: "Nantes",
      postcode: "44000",
      departement: "44",
    });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe(GEOCODE_URLS[0]);
    expect(url.searchParams.get("q")).toBe("Nantes");
    expect(url.searchParams.get("type")).toBe("municipality");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("passes a written postcode as a filter", async () => {
    const fetchMock = vi.fn(async () => json(readCompaniesFixture("geocode-nantes")));
    await geocodeCity("44000 Nantes", { fetch: fetchMock as unknown as typeof fetch });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("q")).toBe("Nantes");
    expect(url.searchParams.get("postcode")).toBe("44000");
  });

  it("tries the second host, then returns null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(json({ type: "FeatureCollection", features: [] }));
    expect(await geocodeCity("Xyzzy", { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain("data.geopf.fr");

    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await geocodeCity("Nantes", { fetch: throwing as unknown as typeof fetch })).toBeNull();
    expect(await geocodeCity(" ", { fetch: throwing as unknown as typeof fetch })).toBeNull();
  });
});

describe("isPlausibleMatch", () => {
  it("keeps the typed commune, rejects a far-fetched best guess", () => {
    expect(isPlausibleMatch("Nantes", "Nantes", 0.3)).toBe(true);
    expect(isPlausibleMatch("saint herblain", "Saint-Herblain", 0.4)).toBe(true);
    expect(isPlausibleMatch("Les Sables", "Les Sables-d'Olonne", 0.5)).toBe(true);
    expect(isPlausibleMatch("France", "Le Lamentin", 0.35)).toBe(false);
    expect(isPlausibleMatch("Nantse", "Nantes", 0.85)).toBe(true);
  });

  it("geocodeCity returns null for a country instead of a random commune", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        features: [
          {
            geometry: { coordinates: [-60.99, 14.61] },
            properties: { city: "Le Lamentin", name: "Le Lamentin", postcode: "97232", score: 0.3 },
          },
        ],
      }),
    );
    expect(await geocodeCity("France", { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
  });
});

describe("postcode helpers", () => {
  it("derives the département", () => {
    expect(departementFromPostcode("44000")).toBe("44");
    expect(departementFromPostcode("01000")).toBe("01");
    expect(departementFromPostcode("20000")).toBe("2A");
    expect(departementFromPostcode("20200")).toBe("2B");
    expect(departementFromPostcode("97400")).toBe("974");
    expect(departementFromPostcode("4400")).toBeNull();
    expect(departementFromPostcode(null)).toBeNull();
    expect(extractPostcode("Nantes (44000)")).toBe("44000");
    expect(extractPostcode("Nantes")).toBeNull();
  });
});
