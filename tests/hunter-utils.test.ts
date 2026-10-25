import { describe, expect, it } from "vitest";

import { haversineKm, isValidPoint, roundKm } from "@/lib/hunter/geo";
import {
  HEADCOUNT_RANGES,
  headcountCodesForSize,
  headcountLabel,
  headcountMin,
  matchesSizeFilter,
  normalizeHeadcountCode,
  sizeBucket,
} from "@/lib/hunter/headcount";
import {
  hintCodesFor,
  isValidNafCode,
  keywordMatches,
  nafLabel,
  NAF_CODES,
  normalizeNafCode,
  normalizeText,
  preselectNafCandidates,
} from "@/lib/hunter/naf";
import { mapWithConcurrency } from "@/lib/hunter/concurrency";
import { GENERIC_FALLBACK_CODES, ROLE_NAF_HINTS } from "@/lib/hunter/role-naf-hints";
import { defaultParamsFromProfile, hunterSearchParamsSchema } from "@/lib/hunter/types";
import { emptyEditableProfile } from "@/lib/profile/mapping";

describe("headcount", () => {
  it("maps every INSEE code to a French label and a minimum", () => {
    expect(headcountLabel("11")).toBe("10 à 19 salariés");
    expect(headcountLabel("53")).toBe("10 000 salariés et plus");
    expect(headcountLabel("01")).toBe("1 ou 2 salariés");
    expect(headcountMin("12")).toBe(20);
    expect(headcountMin("31")).toBe(200);
    expect(Object.keys(HEADCOUNT_RANGES)).toHaveLength(15);
  });

  it("treats NN, null and unknown codes as unknown", () => {
    for (const code of ["NN", null, undefined, "", "99"]) {
      expect(normalizeHeadcountCode(code)).toBeNull();
      expect(headcountLabel(code)).toBe("Effectif inconnu");
      expect(headcountMin(code)).toBeNull();
    }
  });

  it("buckets sizes", () => {
    expect(sizeBucket(null)).toBeNull();
    expect(sizeBucket(0)).toBeNull();
    expect(sizeBucket(1)).toBe("small");
    expect(sizeBucket(20)).toBe("small");
    expect(sizeBucket(50)).toBe("medium");
    expect(sizeBucket(200)).toBe("medium");
    expect(sizeBucket(250)).toBe("large");
    expect(matchesSizeFilter(null, "any")).toBe(true);
    expect(matchesSizeFilter(null, "small")).toBe(false);
    expect(headcountCodesForSize("medium")).toEqual(["21", "22", "31"]);
    expect(headcountCodesForSize("any")).toBeUndefined();
  });
});

describe("geo", () => {
  it("computes haversine distances", () => {
    const nantes = { lat: 47.2173, lng: -1.5534 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(nantes, nantes)).toBe(0);
    const d = haversineKm(nantes, paris);
    expect(d).toBeGreaterThan(338);
    expect(d).toBeLessThan(345);
    expect(haversineKm(paris, nantes)).toBeCloseTo(d, 9);
    expect(roundKm(12.345)).toBe(12.3);
  });

  it("validates points", () => {
    expect(isValidPoint({ lat: 47, lng: -1 })).toBe(true);
    expect(isValidPoint({ lat: Number.NaN, lng: -1 })).toBe(false);
    expect(isValidPoint({ lat: 120, lng: 0 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
});

describe("naf reference", () => {
  it("normalizes and validates codes", () => {
    expect(normalizeNafCode("6202a")).toBe("62.02A");
    expect(normalizeNafCode(" 62.02A ")).toBe("62.02A");
    expect(normalizeNafCode("62.02")).toBeNull();
    expect(isValidNafCode("62.02A")).toBe(true);
    expect(isValidNafCode("99.99Z")).toBe(false);
    expect(nafLabel("70.22Z")).toMatch(/Conseil/);
    expect(NAF_CODES.length).toBe(732);
  });

  it("every hint and fallback code exists in naf.json", () => {
    for (const hint of ROLE_NAF_HINTS) {
      for (const code of hint.codes) expect(isValidNafCode(code), `${hint.id} ${code}`).toBe(true);
    }
    for (const code of GENERIC_FALLBACK_CODES) expect(isValidNafCode(code)).toBe(true);
  });

  it("matches keywords accent-insensitively, whole words or prefixes", () => {
    expect(normalizeText("Développeuse Full-Stack")).toBe("developpeuse full stack");
    expect(keywordMatches("developpeuse full stack", "developpeu*")).toBe(true);
    expect(keywordMatches("charge rh", "rh")).toBe(true);
    expect(keywordMatches("rhone alpes", "rh")).toBe(false);
  });

  it("gives the business analyst hint codes first", () => {
    expect(hintCodesFor(["Business Analyst"]).slice(0, 7)).toEqual([
      "62.02A",
      "62.01Z",
      "70.22Z",
      "64.19Z",
      "65.12Z",
      "66.19B",
      "62.09Z",
    ]);
    expect(hintCodesFor(["Chef de projet MOA"])).toContain("70.22Z");
    expect(hintCodesFor(["Chargée de recrutement"])).toContain("78.10Z");
    expect(hintCodesFor(["Contrôleur de gestion"])).toContain("64.19Z");
    expect(hintCodesFor(["Astronaute"])).toEqual([]);
  });

  it("pre-selects at most 80 valid candidates, hints first", () => {
    const candidates = preselectNafCandidates({
      roles: ["Business Analyst"],
      sectors: ["Banque", "Assurance"],
      skills: ["SQL", "Power BI"],
      degree: "Master Systèmes d'information",
    });
    expect(candidates.length).toBeLessThanOrEqual(80);
    expect(candidates[0].code).toBe("62.02A");
    expect(new Set(candidates.map((c) => c.code)).size).toBe(candidates.length);
    expect(candidates.map((c) => c.code)).toEqual(expect.arrayContaining(["65.12Z", "64.19Z"]));
    expect(candidates.every((c) => isValidNafCode(c.code))).toBe(true);
  });

  it("matches labels by keyword for unknown roles", () => {
    const codes = preselectNafCandidates({
      roles: ["Restauration"],
      sectors: [],
      skills: [],
      degree: null,
    }).map((c) => c.code);
    expect(codes).toContain("56.10A"); // Restauration traditionnelle
  });
});

describe("search params", () => {
  it("defaults from the profile and clamps the radius", () => {
    const profile = {
      ...emptyEditableProfile(),
      city: " Nantes ",
      target_roles: ["Business Analyst"],
      contract_type: "alternance" as const,
      search_radius_km: 300,
    };
    const params = defaultParamsFromProfile(profile);
    expect(params).toEqual({
      roles: ["Business Analyst"],
      sectors: [],
      city: "Nantes",
      radius_km: 100,
      contract_type: "alternance",
      size: "any",
    });
    expect(hunterSearchParamsSchema.safeParse(params).success).toBe(true);
  });

  it("rejects empty roles+sectors, empty city and out-of-range radius with French messages", () => {
    const base = defaultParamsFromProfile({ ...emptyEditableProfile(), city: "Nantes" });
    const r1 = hunterSearchParamsSchema.safeParse(base);
    expect(r1.success).toBe(false);
    expect(r1.error?.issues[0].message).toMatch(/au moins un rôle/);
    const r2 = hunterSearchParamsSchema.safeParse({ ...base, roles: ["BA"], radius_km: 2 });
    expect(r2.error?.issues[0].message).toMatch(/rayon/);
    const r3 = hunterSearchParamsSchema.safeParse({ ...base, roles: ["BA"], city: " " });
    expect(r3.error?.issues[0].message).toMatch(/ville/);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps order and limits parallelism", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 - (n % 3)));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
