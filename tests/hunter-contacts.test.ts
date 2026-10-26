import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyFacts } from "@/lib/hunter/application-types";
import {
  buildContactCandidates,
  findContacts,
  guessEmailPatterns,
  normalizeNamePart,
} from "@/lib/hunter/contacts";
import { clearMxCache, hasMxRecord } from "@/lib/integrations/dns";

const LEADER = { first_name: "Jean-Éric", last_name: "Le Gall", role: "Président" };

afterEach(() => {
  clearMxCache();
  vi.restoreAllMocks();
});

describe("normalizeNamePart", () => {
  it("strips accents, apostrophes and spaces", () => {
    expect(normalizeNamePart("Éloïse")).toBe("eloise");
    expect(normalizeNamePart("Jean Pierre")).toBe("jean-pierre");
    expect(normalizeNamePart("D'Arc")).toBe("darc");
    expect(normalizeNamePart("  Le  Gall ")).toBe("le-gall");
    expect(normalizeNamePart("123")).toBe("");
  });
});

describe("guessEmailPatterns", () => {
  it("returns prenom.nom (medium) then p.nom, prenom, nom (low)", () => {
    expect(guessEmailPatterns("Camille", "Durand", "www.acme.fr")).toEqual([
      { email: "camille.durand@acme.fr", confidence: "medium" },
      { email: "c.durand@acme.fr", confidence: "low" },
      { email: "camille@acme.fr", confidence: "low" },
      { email: "durand@acme.fr", confidence: "low" },
    ]);
  });
  it("returns nothing for unusable parts", () => {
    expect(guessEmailPatterns("", "Durand", "acme.fr")).toEqual([]);
    expect(guessEmailPatterns("A", "B", "localhost")).toEqual([]);
  });
});

describe("buildContactCandidates", () => {
  const base = { leaders: [LEADER], domain: "acme.fr", websiteEmails: [], mxOk: true };

  it("small company (< 50): leader first", () => {
    const list = buildContactCandidates({ ...base, headcountMin: 10 });
    expect(list[0]).toMatchObject({
      email: "jean-eric.le-gall@acme.fr",
      source: "pattern_guess",
      confidence: "medium",
      first_name: "Jean-Éric",
    });
    expect(list.map((c) => c.email)).toContain("recrutement@acme.fr");
    expect(list.find((c) => c.email === "contact@acme.fr")).toMatchObject({
      source: "generic",
      confidence: "low",
    });
  });

  it("larger or unknown company: recruiting / HR before the leader", () => {
    for (const headcountMin of [50, 250, null]) {
      const list = buildContactCandidates({ ...base, headcountMin });
      expect(list[0].email).toBe("recrutement@acme.fr");
      const leaderIdx = list.findIndex((c) => c.source === "pattern_guess");
      expect(list.findIndex((c) => c.email === "rh@acme.fr")).toBeLessThan(leaderIdx);
    }
  });

  it("website recruiting address is first, high confidence", () => {
    const list = buildContactCandidates({
      ...base,
      headcountMin: 200,
      websiteEmails: [{ email: "Recrutement@ACME.fr" }, { email: "info@acme.fr" }],
    });
    expect(list[0]).toEqual({
      first_name: null,
      last_name: null,
      role: "Recrutement",
      email: "recrutement@acme.fr",
      source: "website",
      confidence: "high",
    });
    expect(list.find((c) => c.email === "info@acme.fr")).toMatchObject({
      source: "website",
      confidence: "medium",
    });
    expect(list.filter((c) => c.email === "recrutement@acme.fr")).toHaveLength(1);
  });

  it("leader address published on the site is high and first for a small company", () => {
    const list = buildContactCandidates({
      ...base,
      headcountMin: 3,
      websiteEmails: [{ email: "jean-eric.le-gall@acme.fr" }, { email: "jobs@acme.fr" }],
    });
    expect(list[0]).toMatchObject({
      email: "jean-eric.le-gall@acme.fr",
      source: "website",
      confidence: "high",
    });
    expect(list[1]).toMatchObject({ email: "jobs@acme.fr", confidence: "high" });
  });

  it("no MX → no guessed address (website ones kept)", () => {
    expect(buildContactCandidates({ ...base, headcountMin: 10, mxOk: false })).toEqual([]);
    const list = buildContactCandidates({
      ...base,
      headcountMin: 10,
      mxOk: false,
      websiteEmails: [{ email: "contact@acme.fr" }],
    });
    expect(list.map((c) => c.source)).toEqual(["website"]);
  });

  it("no domain → no candidate; foreign website addresses are dropped", () => {
    expect(buildContactCandidates({ ...base, domain: null, headcountMin: 10 })).toEqual([]);
    const list = buildContactCandidates({
      ...base,
      headcountMin: 10,
      mxOk: false,
      websiteEmails: [{ email: "someone@gmail.com" }],
    });
    expect(list).toEqual([]);
  });

  it("caps the list and keeps only the main leader's other patterns", () => {
    const list = buildContactCandidates({
      ...base,
      headcountMin: 10,
      leaders: [{ first_name: "Paul", last_name: "Martin", role: "Directeur" }, LEADER],
    });
    expect(list.length).toBeLessThanOrEqual(8);
    // Président ranks before Directeur.
    expect(list[0].email).toBe("jean-eric.le-gall@acme.fr");
    expect(list.map((c) => c.email)).not.toContain("p.martin@acme.fr");
  });
});

const COMPANY: CompanyFacts = {
  id: "c1",
  siren: "901234567",
  name: "ACME",
  naf_label: "Conseil",
  city: "Nantes",
  headcount_label: "10 à 19 salariés",
  headcount_min: 10,
  website: "https://www.acme.fr",
  domain: null,
  leaders: [LEADER],
};

describe("findContacts", () => {
  it("combines website + MX and never throws", async () => {
    const list = await findContacts(COMPANY, {
      findEmailsOnWebsite: async (d) => {
        expect(d).toBe("acme.fr");
        return [{ email: "rh@acme.fr", page: "https://www.acme.fr/contact" }];
      },
      hasMxRecord: async () => {
        throw new Error("dns down");
      },
    });
    expect(list).toEqual([expect.objectContaining({ email: "rh@acme.fr", source: "website" })]);
  });

  it("no website nor domain → []", async () => {
    const find = vi.fn();
    expect(
      await findContacts(
        { ...COMPANY, website: null },
        { findEmailsOnWebsite: find, hasMxRecord: find },
      ),
    ).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});

describe("hasMxRecord", () => {
  it("true with a real MX, cached", async () => {
    const resolveMx = vi.fn(async () => [{ exchange: "mx.acme.fr", priority: 10 }]);
    expect(await hasMxRecord("acme.fr", { resolveMx })).toBe(true);
    expect(await hasMxRecord("acme.fr", { resolveMx })).toBe(true);
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });
  it("false for null MX, ENODATA, timeouts and invalid hosts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await hasMxRecord("a.fr", { resolveMx: async () => [{ exchange: ".", priority: 0 }] }),
    ).toBe(false);
    expect(
      await hasMxRecord("b.fr", {
        resolveMx: async () => {
          throw Object.assign(new Error("x"), { code: "ENODATA" });
        },
      }),
    ).toBe(false);
    expect(
      await hasMxRecord("c.fr", { resolveMx: () => new Promise(() => {}), timeoutMs: 10 }),
    ).toBe(false);
    expect(await hasMxRecord("127.0.0.1")).toBe(false);
  });
});
