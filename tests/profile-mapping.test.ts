import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_RADIUS_KM,
  editableToProfileUpdate,
  emptyEditableProfile,
  profileRowToEditable,
  type ProfileRow,
} from "@/lib/profile/mapping";
import { editableProfileSchema } from "@/lib/profile/schema";

const baseRow: ProfileRow = {
  id: "00000000-0000-0000-0000-000000000001",
  user_id: "00000000-0000-0000-0000-0000000000aa",
  full_name: "Léa Moreau",
  email: "lea.moreau@example.com",
  phone: null,
  city: "Nantes",
  school: "IAE Nantes",
  degree: "Master MSI",
  contract_type: "alternance",
  rhythm: "3 semaines / 1 semaine",
  start_date: "2026-09-01",
  target_roles: ["Business Analyst"],
  target_sectors: [],
  search_radius_km: 40,
  skills: ["SQL"],
  experiences: [
    { title: "Assistante MOA", company: null, start: null, end: null, bullets: ["Recette"] },
  ],
  education: [{ degree: "Master MSI", school: "IAE Nantes", start: null, end: null }],
  languages: [{ language: "Anglais", level: "B2" }],
  pitch: null,
  cv_storage_path: "00000000-0000-0000-0000-0000000000aa/cv.pdf",
  cv_text: "texte",
  created_at: "2026-10-25T10:00:00Z",
  updated_at: "2026-10-25T10:00:00Z",
};

describe("profileRowToEditable", () => {
  it("maps a valid row to a valid EditableProfile", () => {
    const p = profileRowToEditable(baseRow);
    expect(editableProfileSchema.parse(p)).toEqual(p);
    expect(p.contract_type).toBe("alternance");
    expect(p.experiences).toHaveLength(1);
    expect(p).not.toHaveProperty("cv_text");
    expect(p).not.toHaveProperty("user_id");
  });

  it("falls back to [] for malformed jsonb and to defaults for bad scalars", () => {
    const p = profileRowToEditable({
      ...baseRow,
      experiences: { title: "not an array" },
      education: "{oops",
      languages: [{ language: "Anglais", level: "B2" }, { lang: "x" }, 42],
      skills: null,
      contract_type: "freelance",
      start_date: "septembre",
      search_radius_km: -5,
    });
    expect(p.experiences).toEqual([]);
    expect(p.education).toEqual([]);
    expect(p.languages).toEqual([{ language: "Anglais", level: "B2" }]);
    expect(p.skills).toEqual([]);
    expect(p.contract_type).toBeNull();
    expect(p.start_date).toBeNull();
    expect(p.search_radius_km).toBe(DEFAULT_SEARCH_RADIUS_KM);
    expect(editableProfileSchema.safeParse(p).success).toBe(true);
  });

  it("parses jsonb returned as a JSON string", () => {
    const p = profileRowToEditable({
      ...baseRow,
      languages: '[{"language":"Espagnol","level":null}]',
    });
    expect(p.languages).toEqual([{ language: "Espagnol", level: null }]);
  });

  it("handles an empty row", () => {
    expect(profileRowToEditable({})).toEqual(emptyEditableProfile());
  });
});

describe("editableToProfileUpdate", () => {
  it("keeps known columns only and never user_id / cv_*", () => {
    const update = editableToProfileUpdate({
      city: "Rennes",
      skills: ["SQL", "Excel"],
      pitch: null,
      degree: undefined,
      user_id: "someone-else",
      cv_text: "x",
      cv_storage_path: "other/cv.pdf",
      id: "x",
      hacker: true,
    } as never);
    expect(update).toEqual({ city: "Rennes", skills: ["SQL", "Excel"], pitch: null });
  });
});
