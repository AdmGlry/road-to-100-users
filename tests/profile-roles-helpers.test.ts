import { describe, expect, it } from "vitest";

import {
  answersToList,
  markTargeted,
  MAX_ANSWERS,
  MAX_TARGETS,
  mergeAnswers,
  mergeTargets,
  type RoleSuggestions,
} from "@/lib/profile/roles-schema";

describe("mergeTargets (addTargetRoleAction)", () => {
  it("adds the role and its sectors", () => {
    const r = mergeTargets(["Business Analyst"], ["Conseil"], "Chef de projet MOA", [
      "Banque et assurance",
      "Conseil",
    ]);
    expect(r.targetRoles).toEqual(["Business Analyst", "Chef de projet MOA"]);
    expect(r.targetSectors).toEqual(["Conseil", "Banque et assurance"]);
    expect(r).toMatchObject({ roleAlreadyPresent: false, roleListFull: false, changed: true });
  });

  it("dedupes case- and accent-insensitively, keeping the existing spelling", () => {
    const r = mergeTargets(
      ["Chargé(e) de marketing digital"],
      ["Énergie"],
      "chargé(e) de MARKETING digital",
      ["energie", "  Énergie "],
    );
    expect(r.targetRoles).toEqual(["Chargé(e) de marketing digital"]);
    expect(r.targetSectors).toEqual(["Énergie"]);
    expect(r).toMatchObject({ roleAlreadyPresent: true, changed: false });
  });

  it("still adds new sectors when the role is already targeted", () => {
    const r = mergeTargets(["Business Analyst"], [], "business analyst", ["Conseil"]);
    expect(r.targetRoles).toEqual(["Business Analyst"]);
    expect(r.targetSectors).toEqual(["Conseil"]);
    expect(r.changed).toBe(true);
  });

  it("caps both lists at 30 and reports a full role list", () => {
    const roles = Array.from({ length: MAX_TARGETS }, (_, i) => `Rôle ${i}`);
    const sectors = Array.from({ length: MAX_TARGETS - 1 }, (_, i) => `Secteur ${i}`);
    const full = mergeTargets(roles, sectors, "Nouveau rôle", ["A"]);
    expect(full.roleListFull).toBe(true);
    expect(full.targetRoles).toHaveLength(MAX_TARGETS);
    expect(full.targetSectors).toHaveLength(MAX_TARGETS - 1); // nothing added
    expect(full.changed).toBe(false);

    const fewer = mergeTargets(roles.slice(1), sectors, "Nouveau rôle", ["A", "B", "C"]);
    expect(fewer.targetRoles).toHaveLength(MAX_TARGETS);
    expect(fewer.targetSectors).toEqual([...sectors, "A"]);
  });

  it("ignores blank values and trims/collapses whitespace", () => {
    const r = mergeTargets([], [], "  Data   Analyst  ", ["", "  "]);
    expect(r.targetRoles).toEqual(["Data Analyst"]);
    expect(r.targetSectors).toEqual([]);
  });
});

describe("mergeAnswers (Affiner les suggestions)", () => {
  it("appends new choices after the previous answers, latest choice wins", () => {
    const merged = mergeAnswers(
      [
        { question: "Mobilité ?", answer: "Oui" },
        { question: "Taille ?", answer: "PME" },
      ],
      { "Mobilité ?": "Non", "Secteur à éviter ?": "Industrie", "Ignorée ?": "" },
    );
    expect(answersToList(merged)).toEqual([
      { question: "Taille ?", answer: "PME" },
      { question: "Mobilité ?", answer: "Non" },
      { question: "Secteur à éviter ?", answer: "Industrie" },
    ]);
  });

  it("keeps only the most recent answers", () => {
    const previous = Array.from({ length: MAX_ANSWERS }, (_, i) => ({
      question: `Q${i}`,
      answer: "A",
    }));
    const merged = answersToList(mergeAnswers(previous, { New: "B" }));
    expect(merged).toHaveLength(MAX_ANSWERS);
    expect(merged.at(-1)).toEqual({ question: "New", answer: "B" });
    expect(merged[0].question).toBe("Q1");
  });
});

describe("markTargeted", () => {
  it("recomputes alreadyTargeted from the current target roles", () => {
    const s: RoleSuggestions = {
      promptVersion: "suggest_roles@1",
      generatedAt: null,
      roles: [
        {
          title: "Business Analyst",
          fit: "fort",
          why: [],
          gap: null,
          sectors: [],
          alreadyTargeted: false,
        },
        {
          title: "Data Analyst",
          fit: "moyen",
          why: [],
          gap: null,
          sectors: [],
          alreadyTargeted: true,
        },
      ],
      questions: [],
      summary: "",
      answers: [],
    };
    const r = markTargeted(s, ["business analyst"]);
    expect(r.roles.map((x) => x.alreadyTargeted)).toEqual([true, false]);
  });
});
