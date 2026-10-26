import { describe, expect, it } from "vitest";

import {
  analyzeMail,
  buildProfileCorpus,
  checkClaims,
  checkMail,
  countWords,
  findBannedWords,
} from "@/lib/hunter/claims";
import { PROFILE } from "./fixtures/enrich";

describe("buildProfileCorpus", () => {
  it("contains profile values, French start date, phone digits but not the e-mail", () => {
    const c = buildProfileCorpus(PROFILE);
    expect(c).toContain("banque populaire");
    expect(c).toContain("septembre 2027");
    expect(c).toContain("sept 2027");
    expect(c).toContain("0612345678");
    expect(c).not.toContain("example");
  });
});

describe("checkClaims", () => {
  it("verifies paraphrased claims grounded in the profile", () => {
    const { verified, unverified } = checkClaims(
      [
        "Stage assistante MOA chez Banque Populaire",
        "Expérience : rédaction de spécifications fonctionnelles",
        "Maîtrise de SQL et Power BI",
        "Master MSI à l'IAE Nantes",
        "Anglais B2",
        "R",
        "3 applications",
      ],
      PROFILE,
    );
    expect(unverified).toEqual([]);
    expect(verified).toHaveLength(7);
  });

  it("flags invented skills, employers, degrees and figures", () => {
    const { unverified } = checkClaims(
      [
        "Maîtrise de Python et Tableau",
        "Stage chez Capgemini",
        "Diplôme d'ingénieur Centrale",
        "Spécifications pour 12 applications",
        "C++",
        "   ",
      ],
      PROFILE,
    );
    expect(unverified).toEqual([
      "Maîtrise de Python et Tableau",
      "Stage chez Capgemini",
      "Diplôme d'ingénieur Centrale",
      "Spécifications pour 12 applications",
      "C++",
    ]);
  });

  it("is accent and case insensitive", () => {
    expect(
      checkClaims(["RECETTE DES EVOLUTIONS", "université de nantes"], PROFILE).unverified,
    ).toEqual([]);
  });
});

describe("countWords / findBannedWords", () => {
  it("counts words, ignoring punctuation-only chunks", () => {
    expect(countWords("Bonjour Madame Durand, – je suis\n\nétudiante.")).toBe(6);
    expect(countWords("")).toBe(0);
  });
  it("detects hollow words in any form", () => {
    expect(findBannedWords("Je suis très MOTIVÉE, dynamique et rigoureuse.")).toEqual([
      "dynamique",
      "motivé",
      "rigoureux",
    ]);
    expect(findBannedWords("Ma motivation est grande")).toEqual(["motivation"]);
    expect(findBannedWords("Je suis curieuse.")).toEqual([]);
  });
});

const words = (n: number) => Array.from({ length: n }, () => "mot").join(" ");

describe("checkMail / analyzeMail", () => {
  const good = {
    subject: "Alternance Business Analyst – sept. 2027 – ACME",
    body: `Bonjour,\n\n${words(100)} 15 minutes septembre 2027 06 12 34 56 78`,
    claims_used: ["Master MSI", "SQL"],
  };

  it("accepts a compliant mail", () => {
    expect(checkMail(good, PROFILE)).toEqual([]);
  });

  it("reports length, subject, banned words, unknown numbers, claims", () => {
    const problems = analyzeMail(
      {
        subject: "x".repeat(71),
        body: `${words(50)} dynamique 40 %`,
        claims_used: ["Python"],
      },
      PROFILE,
    );
    expect(problems.map((p) => p.code).sort()).toEqual(
      [
        "banned_words",
        "claims_unverified",
        "subject_length",
        "unknown_numbers",
        "word_count",
      ].sort(),
    );
  });

  it("accepts numbers coming from the company facts", () => {
    const mail = { ...good, body: `${good.body} 49 salariés` };
    expect(checkMail(mail, PROFILE)).toHaveLength(1);
    expect(checkMail(mail, PROFILE, { allowedText: "20 à 49 salariés" })).toEqual([]);
  });

  it("flags an empty claims list and an empty subject", () => {
    const codes = analyzeMail({ ...good, subject: " ", claims_used: [] }, PROFILE).map(
      (p) => p.code,
    );
    expect(codes).toEqual(["claims_missing", "subject_empty"]);
  });
  it("accepts the student's own phone in any format, flags another one", () => {
    const own = { ...good, body: good.body.replace("06 12 34 56 78", "+33 6 12 34 56 78") };
    expect(checkMail(own, PROFILE)).toEqual([]);
    const other = { ...good, body: good.body.replace("06 12 34 56 78", "07 98 76 54 32") };
    expect(analyzeMail(other, PROFILE).map((p) => p.code)).toEqual(["unknown_numbers"]);
  });
});
