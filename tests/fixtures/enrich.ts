/** Shared fixtures for the Sprint 3 enrichment tests (fictional student). */
import type { CompanyFacts } from "@/lib/hunter/application-types";
import type { EditableProfile } from "@/lib/profile/schema";

export const PROFILE: EditableProfile = {
  full_name: "Camille Durand",
  email: "camille@example.com",
  phone: "06 12 34 56 78",
  city: "Nantes",
  school: "IAE Nantes",
  degree: "Master MSI",
  skills: ["SQL", "Power BI", "Gestion de projet", "R"],
  experiences: [
    {
      title: "Stage assistante MOA",
      company: "Banque Populaire",
      start: "avril 2025",
      end: "août 2025",
      bullets: [
        "Rédaction de spécifications fonctionnelles pour 3 applications",
        "Recette des évolutions",
      ],
    },
  ],
  education: [
    { degree: "Licence MIASHS", school: "Université de Nantes", start: null, end: "2024" },
  ],
  languages: [{ language: "Anglais", level: "B2" }],
  pitch: "Étudiante en Master MSI, j'aime relier métier et données.",
  contract_type: "alternance",
  rhythm: "3 semaines entreprise / 1 semaine école",
  start_date: "2027-09-01",
  target_roles: ["Business Analyst"],
  target_sectors: ["Banque"],
  search_radius_km: 30,
};

export const COMPANY: CompanyFacts = {
  id: "c1",
  siren: "901234567",
  name: "ACME",
  naf_label: "Conseil en systèmes et logiciels informatiques",
  city: "Nantes",
  headcount_label: "20 à 49 salariés",
  headcount_min: 20,
  website: null,
  domain: null,
  leaders: [],
};

export const filler = (n: number) => Array.from({ length: n }, () => "mot").join(" ");

/** A body that passes every check (between 120 and 180 words). */
export function goodMail(extra = "") {
  return {
    subject: "Alternance Business Analyst – sept. 2027 – ACME",
    body: `Bonjour,\n\n${filler(95)} ${extra}\n\nCamille Durand\nMaster MSI, IAE Nantes\n06 12 34 56 78`,
    claims_used: ["Stage assistante MOA chez Banque Populaire", "SQL"],
  };
}
