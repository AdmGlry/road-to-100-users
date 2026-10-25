import { beforeAll, describe, expect, it } from "vitest";

import { groundProfile, normalizeForMatch } from "@/lib/profile/grounding";
import { extractCvText } from "@/lib/profile/parse-cv";
import type { ExtractedProfile } from "@/lib/profile/schema";

import { CV_FIXTURES, readCvPdf, readExpected, type CvFixture } from "./fixtures/cv";

const texts = {} as Record<CvFixture, string>;

beforeAll(async () => {
  for (const name of CV_FIXTURES) texts[name] = await extractCvText(readCvPdf(name));
});

describe("normalizeForMatch", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeForMatch("  Économie-Gestion, Lycée  d'Albi ! ")).toBe(
      "economie gestion lycee d albi",
    );
    expect(normalizeForMatch("Œuvre")).toBe("oeuvre");
  });
});

describe("groundProfile on the reference CVs", () => {
  it.each(CV_FIXTURES)("keeps the ground truth of %s untouched", (name) => {
    const expected = readExpected(name);
    const { profile, removed } = groundProfile(expected, texts[name]);
    expect(removed).toEqual([]);
    expect(profile).toEqual(expected);
  });

  it("accepts a pitch made of facts from the CV", () => {
    const expected = readExpected("cv-business-analyst");
    const pitch =
      "Je suis en Master MSI à l'IAE Nantes et je cherche une alternance de Business Analyst. J'ai fait un stage de 3 mois en 2025.";
    const { profile, removed } = groundProfile(
      { ...expected, pitch },
      texts["cv-business-analyst"],
    );
    expect(removed).toEqual([]);
    expect(profile.pitch).toBe(pitch);
  });

  it("accepts formatting variants (accents, case, phone format)", () => {
    const expected = readExpected("cv-business-analyst");
    const variant: ExtractedProfile = {
      ...expected,
      full_name: "LEA MOREAU",
      phone: "+33 6 00 00 00 01",
      email: "Lea.Moreau@example.com",
      skills: [...expected.skills, "power bi"],
    };
    const { profile, removed } = groundProfile(variant, texts["cv-business-analyst"]);
    expect(removed).toEqual([]);
    expect(profile.full_name).toBe("LEA MOREAU");
    expect(profile.skills).toEqual(expected.skills); // duplicate "power bi" merged
  });
});

describe("groundProfile removes invented values", () => {
  const name = "cv-business-analyst";

  it("drops invented skills, experiences, education and languages", () => {
    const expected = readExpected(name);
    const invented: ExtractedProfile = {
      ...expected,
      skills: [...expected.skills, "Kubernetes", "SAP"],
      experiences: [
        ...expected.experiences,
        {
          title: "Consultante data",
          company: "Capgemini",
          start: "2023",
          end: "2024",
          bullets: ["Migration d'un datawarehouse vers Snowflake"],
        },
      ],
      education: [
        ...expected.education,
        { degree: "MBA Finance", school: "HEC Paris", start: null, end: "2021" },
      ],
      languages: [...expected.languages, { language: "Japonais", level: "courant" }],
    };
    const { profile, removed } = groundProfile(invented, texts[name]);
    expect(profile).toEqual(expected);
    expect(removed).toEqual([
      "skills[8]",
      "skills[9]",
      "experiences[2]",
      "education[2]",
      "languages[2]",
    ]);
  });

  it("nulls an invented company, school, date, bullet and language level", () => {
    const expected = readExpected(name);
    const tampered = structuredClone(expected);
    tampered.experiences[0].company = "Société Générale";
    tampered.experiences[0].start = "janv. 2019";
    tampered.experiences[0].bullets.push("Pilotage d'un budget de 2 millions d'euros chez Airbus");
    tampered.education[0].school = "Sorbonne Université";
    tampered.languages[1].level = "C2 bilingue";
    const { profile, removed } = groundProfile(tampered, texts[name]);
    expect(profile.experiences[0]).toEqual({
      ...expected.experiences[0],
      company: null,
      start: null,
    });
    expect(profile.education[0].school).toBeNull();
    expect(profile.languages[1].level).toBeNull();
    expect(removed.sort()).toEqual(
      [
        "experiences[0].company",
        "experiences[0].start",
        "experiences[0].bullets[3]",
        "education[0].school",
        "languages[1].level",
      ].sort(),
    );
  });

  it("nulls an invented e-mail, phone, name, city, school and degree", () => {
    const expected = readExpected(name);
    const { profile, removed } = groundProfile(
      {
        ...expected,
        email: "lea.moreau@gmail.com",
        phone: "06 12 34 56 78",
        full_name: "Léa Dupont",
        city: "Paris",
        school: "ESSEC",
        degree: "Master Finance",
      },
      texts[name],
    );
    for (const field of ["email", "phone", "full_name", "city", "school", "degree"] as const) {
      expect(profile[field]).toBeNull();
    }
    expect(removed).toEqual(["full_name", "email", "phone", "city", "school", "degree"]);
  });

  it("drops a pitch that quotes a number absent from the CV", () => {
    const expected = readExpected(name);
    const { profile, removed } = groundProfile(
      { ...expected, pitch: "J'ai 5 ans d'expérience en analyse de données." },
      texts[name],
    );
    expect(profile.pitch).toBeNull();
    expect(removed).toEqual(["pitch"]);
  });

  it("keeps a bullet that is mostly grounded (≥60 % of significant words)", () => {
    const expected = readExpected(name);
    const tampered = structuredClone(expected);
    tampered.experiences[0].bullets[0] =
      "Rédaction des spécifications fonctionnelles d'une application de crédits";
    const { removed } = groundProfile(tampered, texts[name]);
    expect(removed).toEqual([]);
  });

  it("never puts values in `removed`, only paths", () => {
    const expected = readExpected(name);
    const { removed } = groundProfile({ ...expected, email: "secret@evil.test" }, texts[name]);
    expect(removed.join(" ")).not.toContain("secret");
  });

  it("silently drops empty strings (not counted as invented)", () => {
    const expected = readExpected(name);
    const { profile, removed } = groundProfile(
      { ...expected, phone: "  ", skills: [...expected.skills, ""] },
      texts[name],
    );
    expect(profile.phone).toBeNull();
    expect(profile.skills).toEqual(expected.skills);
    expect(removed).toEqual([]);
  });
});
