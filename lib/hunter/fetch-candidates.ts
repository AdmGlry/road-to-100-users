/**
 * Candidate retrieval from the API Recherche d'entreprises (SPEC §7.1):
 * /near_point around the student's city (up to 6 pages of 25), completed by
 * /search on the département when that yields fewer than `minWanted` usable companies.
 */
import {
  CompaniesApiError,
  type CompaniesClient,
  type CompaniesPage,
  type CompanyResult,
} from "@/lib/integrations/companies";

import { HEADCOUNT_RANGES, headcountCodesForSize } from "./headcount";
import type { GeoPoint, SizeFilter } from "./types";

/** /near_point radius cap (API documentation: 50 km max). Farther results come from /search. */
export const NEAR_POINT_MAX_RADIUS_KM = 50;
export const NEAR_POINT_MAX_PAGES = 6;
export const SEARCH_MAX_PAGES = 4;
export const MIN_WANTED_CANDIDATES = 60;
const MATCHING_ESTABLISHMENTS = 5;

export type FetchCandidatesInput = {
  origin: GeoPoint | null;
  departement: string | null;
  radiusKm: number;
  nafCodes: readonly string[];
  size: SizeFilter;
  minWanted?: number;
};

export type FetchCandidatesResult = {
  results: CompanyResult[];
  requests: number;
  sources: { near_point: number; search: number };
};

export type FetchProgress = (done: number, total: number) => void | Promise<void>;

const usable = (r: CompanyResult) =>
  r.etat_administratif === "A" && r.complements?.est_entrepreneur_individuel !== true;

async function fetchPages(
  fetchPage: (page: number) => Promise<CompaniesPage>,
  maxPages: number,
  onPage: () => Promise<void>,
  onTotal: (pages: number) => void,
): Promise<CompanyResult[]> {
  const first = await fetchPage(1);
  const pages = Math.max(1, Math.min(maxPages, first.total_pages || 1));
  onTotal(pages);
  await onPage();
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, async (_, i) => {
      const page = await fetchPage(i + 2);
      await onPage();
      return page.results;
    }),
  );
  return [...first.results, ...rest.flat()];
}

export async function fetchCandidates(
  client: CompaniesClient,
  input: FetchCandidatesInput,
  onProgress?: FetchProgress,
): Promise<FetchCandidatesResult> {
  const minWanted = input.minWanted ?? MIN_WANTED_CANDIDATES;
  const nafCodes = [...input.nafCodes];
  let requests = 0;
  let planned = (input.origin ? NEAR_POINT_MAX_PAGES : 0) + (input.departement ? 1 : 0);
  const report = async () => {
    requests++;
    try {
      await onProgress?.(requests, Math.max(planned, requests));
    } catch {
      // ignore progress errors
    }
  };

  const bySiren = new Map<string, CompanyResult>();
  const add = (list: CompanyResult[]) => {
    let added = 0;
    for (const r of list) {
      if (!bySiren.has(r.siren)) {
        bySiren.set(r.siren, r);
        added++;
      }
    }
    return added;
  };
  const sources = { near_point: 0, search: 0 };
  let lastError: unknown = null;

  if (input.origin) {
    try {
      const results = await fetchPages(
        (page) =>
          client.searchNearPoint({
            lat: input.origin!.lat,
            long: input.origin!.lng,
            radius: Math.min(NEAR_POINT_MAX_RADIUS_KM, Math.max(1, input.radiusKm)),
            activite_principale: nafCodes,
            limite_matching_etablissements: MATCHING_ESTABLISHMENTS,
            page,
            per_page: 25,
          }),
        NEAR_POINT_MAX_PAGES,
        report,
        (pages) => {
          planned = pages + (input.departement ? 1 : 0);
        },
      );
      sources.near_point = add(results);
    } catch (e) {
      lastError = e;
    }
  }

  const usableCount = [...bySiren.values()].filter(usable).length;
  if (input.departement && usableCount < minWanted) {
    // Skip unknown / 0 headcount server-side (they are excluded by the pre-filter anyway).
    const tranches =
      headcountCodesForSize(input.size) ?? Object.keys(HEADCOUNT_RANGES).filter((c) => c !== "00");
    try {
      const results = await fetchPages(
        (page) =>
          client.searchCompanies({
            activite_principale: nafCodes,
            departement: [input.departement!],
            etat_administratif: "A",
            tranche_effectif_salarie: tranches,
            limite_matching_etablissements: MATCHING_ESTABLISHMENTS,
            page,
            per_page: 25,
          }),
        SEARCH_MAX_PAGES,
        report,
        (pages) => {
          planned = requests + pages;
        },
      );
      sources.search = add(results);
    } catch (e) {
      lastError ??= e;
    }
  }

  if (bySiren.size === 0 && lastError) {
    throw lastError instanceof CompaniesApiError
      ? lastError
      : new CompaniesApiError("network", "Companies API failed");
  }
  return { results: [...bySiren.values()], requests, sources };
}
