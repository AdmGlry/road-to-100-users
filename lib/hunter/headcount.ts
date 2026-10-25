/**
 * INSEE "tranche d'effectif salarié" codes → readable French labels and size buckets.
 */
import type { SizeBucket, SizeFilter } from "./types";

type Range = { min: number; max: number | null; label: string };

export const HEADCOUNT_RANGES: Readonly<Record<string, Range>> = {
  "00": { min: 0, max: 0, label: "0 salarié" },
  "01": { min: 1, max: 2, label: "1 ou 2 salariés" },
  "02": { min: 3, max: 5, label: "3 à 5 salariés" },
  "03": { min: 6, max: 9, label: "6 à 9 salariés" },
  "11": { min: 10, max: 19, label: "10 à 19 salariés" },
  "12": { min: 20, max: 49, label: "20 à 49 salariés" },
  "21": { min: 50, max: 99, label: "50 à 99 salariés" },
  "22": { min: 100, max: 199, label: "100 à 199 salariés" },
  "31": { min: 200, max: 249, label: "200 à 249 salariés" },
  "32": { min: 250, max: 499, label: "250 à 499 salariés" },
  "41": { min: 500, max: 999, label: "500 à 999 salariés" },
  "42": { min: 1000, max: 1999, label: "1 000 à 1 999 salariés" },
  "51": { min: 2000, max: 4999, label: "2 000 à 4 999 salariés" },
  "52": { min: 5000, max: 9999, label: "5 000 à 9 999 salariés" },
  "53": { min: 10000, max: null, label: "10 000 salariés et plus" },
};

export const UNKNOWN_HEADCOUNT_LABEL = "Effectif inconnu";

/** Returns the code if it is a known INSEE code ("NN", null, garbage → null). */
export function normalizeHeadcountCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim();
  return Object.prototype.hasOwnProperty.call(HEADCOUNT_RANGES, c) ? c : null;
}

export function headcountLabel(code: string | null | undefined): string {
  const c = normalizeHeadcountCode(code);
  return c ? HEADCOUNT_RANGES[c].label : UNKNOWN_HEADCOUNT_LABEL;
}

export function headcountMin(code: string | null | undefined): number | null {
  const c = normalizeHeadcountCode(code);
  return c ? HEADCOUNT_RANGES[c].min : null;
}

/** small = 1–49, medium = 50–249, large = 250+; null for unknown or 0 employees. */
export function sizeBucket(min: number | null): SizeBucket | null {
  if (min === null || min <= 0) return null;
  if (min < 50) return "small";
  if (min < 250) return "medium";
  return "large";
}

export function matchesSizeFilter(min: number | null, filter: SizeFilter): boolean {
  return filter === "any" || sizeBucket(min) === filter;
}

/** INSEE codes of a size filter (for the /search `tranche_effectif_salarie` parameter). */
export function headcountCodesForSize(filter: SizeFilter): string[] | undefined {
  if (filter === "any") return undefined;
  return Object.entries(HEADCOUNT_RANGES)
    .filter(([, r]) => sizeBucket(r.min) === filter)
    .map(([code]) => code);
}
