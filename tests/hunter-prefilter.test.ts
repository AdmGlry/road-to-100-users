import { describe, expect, it } from "vitest";

import {
  distanceFit,
  nafFit,
  prefilterCompanies,
  sizeFit,
  PREFILTER_LIMIT,
} from "@/lib/hunter/prefilter";
import type { NormalizedCompany } from "@/lib/hunter/types";

let n = 0;
function company(
  over: Partial<NormalizedCompany> & { distance?: number | null } = {},
): NormalizedCompany {
  const { distance = 5, ...rest } = over;
  n++;
  return {
    siren: String(100000000 + n),
    name: `Entreprise ${n}`,
    naf_code: "62.02A",
    naf_label: "Conseil en systèmes et logiciels informatiques",
    headcount_code: "12",
    headcount_label: "20 à 49 salariés",
    headcount_min: 20,
    category: "PME",
    is_active: true,
    is_association: false,
    is_individual: false,
    leaders: [],
    raw_minimal: {},
    establishment: {
      siret: null,
      address: null,
      postal_code: null,
      city: "NANTES",
      lat: null,
      lng: null,
      distance_km: distance,
    },
    ...rest,
  };
}

const base = { radiusKm: 30, nafCodes: ["62.02A", "70.22Z", "64.19Z"] };

describe("prefilter exclusions", () => {
  it("excludes closed, individual, unknown size, contacted, too far and wrong size", () => {
    const keep = company();
    const closed = company({ is_active: false });
    const individual = company({ is_individual: true });
    const unknown = company({ headcount_code: null, headcount_min: null });
    const zero = company({ headcount_code: "00", headcount_min: 0 });
    const contacted = company();
    const far = company({ distance: 31 });
    const r = prefilterCompanies([keep, closed, individual, unknown, zero, contacted, far, keep], {
      ...base,
      contactedSirens: [contacted.siren],
    });
    expect(r.kept.map((c) => c.siren)).toEqual([keep.siren]);
    expect(r.excluded).toEqual({
      closed: 1,
      individual: 1,
      unknown_size: 2,
      contacted: 1,
      too_far: 1,
      size_mismatch: 0,
      duplicate: 1,
    });

    const large = company({ headcount_code: "53", headcount_min: 10000 });
    const sized = prefilterCompanies([keep, large], { ...base, size: "large" });
    expect(sized.kept.map((c) => c.siren)).toEqual([large.siren]);
    expect(sized.excluded.size_mismatch).toBe(1);
  });

  it("can keep unknown sizes and companies without distance", () => {
    const unknown = company({ headcount_code: null, headcount_min: null, distance: null });
    const r = prefilterCompanies([unknown], { ...base, excludeUnknownSize: false });
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].prefilter_score).toBeGreaterThan(0);
  });
});

describe("prefilter scoring", () => {
  it("prefers closer, well-sized, higher-priority NAF companies", () => {
    expect(distanceFit(0, 30)).toBe(1);
    expect(distanceFit(30, 30)).toBeCloseTo(0.1);
    expect(distanceFit(null, 30)).toBeCloseTo(0.1);
    expect(sizeFit(20)).toBe(1);
    expect(sizeFit(5000)).toBeLessThan(sizeFit(200));
    expect(sizeFit(5000)).toBeGreaterThan(sizeFit(1));
    expect(sizeFit(5000, "cdi")).toBeGreaterThan(sizeFit(5000, "alternance"));
    expect(nafFit("62.02A", base.nafCodes)).toBe(1);
    expect(nafFit("64.19Z", base.nafCodes)).toBeCloseTo(0.4);
    expect(nafFit("01.11Z", base.nafCodes)).toBe(0.2);

    const near = company({ distance: 1 });
    const farther = company({ distance: 20 });
    const tiny = company({ distance: 1, headcount_code: "01", headcount_min: 1 });
    const lowNaf = company({ distance: 1, naf_code: "64.19Z" });
    const r = prefilterCompanies([farther, tiny, lowNaf, near], base);
    expect(r.kept[0].siren).toBe(near.siren);
    expect(r.kept.map((c) => c.siren)).toEqual(
      [...r.kept].sort((a, b) => b.prefilter_score - a.prefilter_score).map((c) => c.siren),
    );
    for (const c of r.kept) {
      expect(c.prefilter_score).toBeGreaterThanOrEqual(0);
      expect(c.prefilter_score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(c.prefilter_score)).toBe(true);
    }
    expect(r.kept.find((c) => c.siren === near.siren)!.prefilter_score).toBeGreaterThan(
      r.kept.find((c) => c.siren === farther.siren)!.prefilter_score,
    );
  });

  it("keeps the top 60", () => {
    const many = Array.from({ length: 90 }, (_, i) => company({ distance: i / 3 }));
    const r = prefilterCompanies(many, base);
    expect(PREFILTER_LIMIT).toBe(60);
    expect(r.kept).toHaveLength(60);
    expect(r.eligibleCount).toBe(90);
    expect(r.kept[0].establishment?.distance_km).toBe(0);
    expect(prefilterCompanies(many, { ...base, limit: 10 }).kept).toHaveLength(10);
  });
});
