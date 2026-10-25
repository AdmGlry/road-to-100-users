import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export type CompaniesFixture = "near-point-nantes" | "search-departement-44" | "geocode-nantes";

/** Fresh copy of a hand-crafted API response (shapes verified against the live API). */
export function readCompaniesFixture(name: CompaniesFixture): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

export const NANTES = { lat: 47.2173, lng: -1.5534 };
