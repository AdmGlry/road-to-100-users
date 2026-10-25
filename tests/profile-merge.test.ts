import { describe, expect, it } from "vitest";

import { emptyEditableProfile } from "@/lib/profile/mapping";
import { applyCvChanges, proposeCvChanges } from "@/lib/profile/merge";
import { EXTRACTED_FIELDS, type EditableProfile } from "@/lib/profile/schema";

import { readExpected } from "./fixtures/cv";

const extracted = { ...readExpected("cv-business-analyst"), pitch: "Je cherche une alternance." };

function filled(): EditableProfile {
  return { ...emptyEditableProfile(), ...structuredClone(extracted), contract_type: "alternance" };
}

describe("proposeCvChanges", () => {
  it("accepts everything by default on an empty profile", () => {
    const changes = proposeCvChanges(emptyEditableProfile(), extracted);
    expect(changes.map((c) => c.field)).toEqual(EXTRACTED_FIELDS);
    expect(changes.every((c) => c.defaultAccept)).toBe(true);
    expect(changes.find((c) => c.field === "city")?.label).toBe("Ville");
  });

  it("proposes nothing when the new CV gives the same values (modulo case/accents)", () => {
    const current = filled();
    current.full_name = "LEA MOREAU";
    expect(proposeCvChanges(current, extracted)).toEqual([]);
  });

  it("does not pre-accept a change over a user correction, nor apply it unless accepted", () => {
    const current = filled();
    current.degree = "Master Management des Systèmes d'Information";
    current.experiences[0].title = "Assistante MOA (corrigé)";

    const changes = proposeCvChanges(current, extracted);
    expect(changes.map((c) => c.field).sort()).toEqual(["degree", "experiences"]);
    expect(changes.every((c) => !c.defaultAccept)).toBe(true);
    const degree = changes.find((c) => c.field === "degree")!;
    expect(degree.current).toBe("Master Management des Systèmes d'Information");
    expect(degree.proposed).toBe("Master MSI");

    const kept = applyCvChanges(current, changes, []);
    expect(kept).toEqual(current);

    const applied = applyCvChanges(current, changes, ["degree"]);
    expect(applied.degree).toBe("Master MSI");
    expect(applied.experiences[0].title).toBe("Assistante MOA (corrigé)");
    expect(current.degree).toBe("Master Management des Systèmes d'Information"); // not mutated
  });

  it("never proposes to erase a value the new CV does not contain", () => {
    const current = filled();
    const changes = proposeCvChanges(current, { ...extracted, phone: null, languages: [] });
    expect(changes).toEqual([]);
  });

  it("proposes the union of skills, accepted by default", () => {
    const current = filled();
    current.skills = ["sql", "Gestion de projet"];
    const changes = proposeCvChanges(current, extracted);
    const skills = changes.find((c) => c.field === "skills")!;
    expect(skills.defaultAccept).toBe(true);
    expect(skills.current).toEqual(["sql", "Gestion de projet"]);
    expect(skills.proposed).toEqual([
      "sql",
      "Gestion de projet",
      "Excel",
      "Power BI",
      "Jira",
      "Confluence",
      "UML",
      "BPMN",
      "Scrum",
    ]);
  });

  it("proposes no skills change when the new CV adds nothing", () => {
    const current = filled();
    current.skills = [...extracted.skills, "Gestion de projet"];
    expect(proposeCvChanges(current, extracted).find((c) => c.field === "skills")).toBeUndefined();
  });
});

describe("applyCvChanges", () => {
  it("ignores unknown or forged field names", () => {
    const current = emptyEditableProfile();
    const forged = [
      {
        field: "contract_type" as never,
        label: "x",
        current: null,
        proposed: "cdi",
        defaultAccept: true,
      },
    ];
    expect(applyCvChanges(current, forged, ["contract_type", "nope"])).toEqual(current);
  });
});
