import { describe, expect, it } from "vitest";

import {
  addTags,
  applyPatch,
  checkCvFile,
  diffProfile,
  extractedToPatch,
  formatExperience,
  formatFieldValue,
  hasNoExtractedData,
  hasPdfSignature,
  normalizeProfile,
  removeTagAt,
} from "@/components/profile/profile-utils";
import type { EditableProfile, ExtractedProfile } from "@/lib/profile/schema";

const empty = (): EditableProfile => ({
  full_name: null,
  email: null,
  phone: null,
  city: null,
  school: null,
  degree: null,
  skills: [],
  experiences: [],
  education: [],
  languages: [],
  pitch: null,
  contract_type: null,
  rhythm: null,
  start_date: null,
  target_roles: [],
  target_sectors: [],
  search_radius_km: 30,
});

describe("addTags", () => {
  it("adds trimmed values and splits on commas", () => {
    expect(addTags([], "  Excel ,SQL,, ").tags).toEqual(["Excel", "SQL"]);
  });

  it("dedupes case-insensitively and keeps the existing spelling", () => {
    expect(addTags(["Excel"], "excel, EXCEL, Python").tags).toEqual(["Excel", "Python"]);
    expect(addTags([], "Élan, élan").tags).toEqual(["Élan"]);
  });

  it("collapses inner whitespace", () => {
    expect(addTags([], "Gestion   de\tprojet").tags).toEqual(["Gestion de projet"]);
  });

  it("caps the list and reports overflow", () => {
    const result = addTags(["a", "b"], "c, d, e", 3);
    expect(result.tags).toEqual(["a", "b", "c"]);
    expect(result.overflow).toBe(2);
  });

  it("does not mutate the input", () => {
    const tags = ["a"];
    addTags(tags, "b");
    expect(tags).toEqual(["a"]);
  });

  it("removes by index", () => {
    expect(removeTagAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("normalizeProfile", () => {
  it("trims strings, turns blanks into null and drops empty rows", () => {
    const p = {
      ...empty(),
      full_name: "  Léa Martin ",
      city: "   ",
      skills: [" SQL ", ""],
      experiences: [
        { title: "", company: null, start: null, end: null, bullets: ["", " "] },
        { title: " Stage ", company: " ACME ", start: "", end: null, bullets: ["a", "", " b "] },
      ],
      languages: [{ language: "", level: null }],
    };
    const n = normalizeProfile(p);
    expect(n.full_name).toBe("Léa Martin");
    expect(n.city).toBeNull();
    expect(n.skills).toEqual(["SQL"]);
    expect(n.experiences).toEqual([
      { title: "Stage", company: "ACME", start: null, end: null, bullets: ["a", "b"] },
    ]);
    expect(n.languages).toEqual([]);
  });
});

describe("diffProfile", () => {
  it("returns only the changed fields", () => {
    const saved = empty();
    const next = { ...saved, city: "Lyon", search_radius_km: 50 };
    expect(diffProfile(saved, next)).toEqual({ city: "Lyon", search_radius_km: 50 });
  });

  it("ignores changes that vanish once normalized (blank row, trailing space)", () => {
    const saved = { ...empty(), city: "Lyon" };
    const next = {
      ...saved,
      city: "Lyon ",
      education: [{ degree: "", school: null, start: null, end: null }],
    };
    expect(diffProfile(saved, next)).toEqual({});
  });

  it("sends whole list fields when one item changes", () => {
    const saved = { ...empty(), target_roles: ["BA"] };
    const next = { ...saved, target_roles: ["BA", "PO"] };
    expect(diffProfile(saved, next)).toEqual({ target_roles: ["BA", "PO"] });
  });

  it("is empty after applying its own patch", () => {
    const saved = empty();
    const next = { ...saved, pitch: "Je suis étudiante.", skills: ["SQL"] };
    const patch = diffProfile(saved, next);
    expect(diffProfile(applyPatch(saved, patch), next)).toEqual({});
  });
});

describe("hasNoExtractedData / extractedToPatch", () => {
  it("is true for an empty profile even with preferences set", () => {
    expect(hasNoExtractedData({ ...empty(), contract_type: "stage", target_roles: ["BA"] })).toBe(
      true,
    );
  });

  it("ignores an email that only repeats the account email", () => {
    const p = { ...empty(), email: "Lea@Example.com" };
    expect(hasNoExtractedData(p, "lea@example.com")).toBe(true);
    expect(hasNoExtractedData(p, "other@example.com")).toBe(false);
    expect(hasNoExtractedData(p)).toBe(false);
  });

  it("is false as soon as one extracted field has data", () => {
    expect(hasNoExtractedData({ ...empty(), skills: ["SQL"] })).toBe(false);
  });

  it("keeps only non-empty extracted fields", () => {
    const extracted: ExtractedProfile = {
      full_name: "Léa",
      email: null,
      phone: null,
      city: "",
      school: null,
      degree: null,
      skills: ["SQL"],
      experiences: [],
      education: [],
      languages: [],
      pitch: null,
    };
    expect(extractedToPatch(extracted)).toEqual({ full_name: "Léa", skills: ["SQL"] });
  });
});

describe("formatFieldValue", () => {
  it("formats experiences as « Titre — Entreprise (début – fin) »", () => {
    expect(
      formatExperience({
        title: "Assistant chef de projet",
        company: "ACME",
        start: "sept. 2024",
        end: "juin 2025",
        bullets: [],
      }),
    ).toBe("Assistant chef de projet — ACME (sept. 2024 – juin 2025)");
    expect(
      formatExperience({ title: "Vendeur", company: null, start: "2023", end: null, bullets: [] }),
    ).toBe("Vendeur (depuis 2023)");
  });

  it("formats lists, languages, education and empty values", () => {
    expect(formatFieldValue("skills", ["SQL", "Excel"])).toEqual(["SQL", "Excel"]);
    expect(formatFieldValue("languages", [{ language: "Anglais", level: "C1" }])).toEqual([
      "Anglais (C1)",
    ]);
    expect(
      formatFieldValue("education", [
        { degree: "Master MSI", school: "IAE", start: "2024", end: "2026" },
      ]),
    ).toEqual(["Master MSI — IAE (2024 – 2026)"]);
    expect(formatFieldValue("city", "Lyon")).toEqual(["Lyon"]);
    expect(formatFieldValue("city", null)).toEqual([]);
    expect(formatFieldValue("skills", [])).toEqual([]);
  });
});

describe("checkCvFile / hasPdfSignature", () => {
  const MAX = 5 * 1024 * 1024;

  it("accepts a PDF under the limit", () => {
    expect(checkCvFile({ name: "cv.pdf", type: "application/pdf", size: 1000 }, MAX)).toBeNull();
    // Some browsers give no MIME type: the extension is enough here (signature checked next).
    expect(checkCvFile({ name: "CV.PDF", type: "", size: 1000 }, MAX)).toBeNull();
  });

  it("rejects other types, empty and too large files with French messages", () => {
    expect(checkCvFile({ name: "cv.docx", type: "application/msword", size: 10 }, MAX)).toMatch(
      /pas un PDF/,
    );
    expect(checkCvFile({ name: "cv.pdf", type: "application/pdf", size: 0 }, MAX)).toMatch(/vide/);
    expect(checkCvFile({ name: "cv.pdf", type: "application/pdf", size: MAX + 1 }, MAX)).toMatch(
      /5 Mo/,
    );
  });

  it("checks the %PDF- signature", () => {
    expect(hasPdfSignature(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasPdfSignature(new TextEncoder().encode("PK\u0003\u0004"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });
});
