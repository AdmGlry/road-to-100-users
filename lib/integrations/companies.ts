/**
 * API Recherche d'entreprises (https://recherche-entreprises.api.gouv.fr), SPEC §7.1.
 * SERVER ONLY. Free, no key, ≈7 req/s per IP → shared limiter (5 req/s, 3 in flight)
 * + retry with backoff on HTTP 429 / 5xx / network errors / timeouts (2 retries).
 *
 * Responses are parsed leniently with Zod (unknown keys allowed, missing fields → null).
 * Dirigeants are minimised (GDPR): only natural persons with a managerial role,
 * first name / last name / role. Birth dates are never kept.
 */
import { z } from "zod";

import { haversineKm, isValidPoint, roundKm } from "@/lib/hunter/geo";
import { headcountLabel, headcountMin, normalizeHeadcountCode } from "@/lib/hunter/headcount";
import { nafLabel, normalizeNafCode } from "@/lib/hunter/naf";
import type { Establishment, GeoPoint, Leader, NormalizedCompany } from "@/lib/hunter/types";

export const COMPANIES_API_BASE_URL = "https://recherche-entreprises.api.gouv.fr";
export const MAX_PER_PAGE = 25;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = [600, 1800];
const DEFAULT_MIN_INTERVAL_MS = 200; // 5 requests / second
const DEFAULT_MAX_CONCURRENT = 3;

// ---------------------------------------------------------------------------
// Errors

export type CompaniesApiErrorCode =
  "bad_request" | "rate_limited" | "http_error" | "timeout" | "network" | "invalid_response";

export class CompaniesApiError extends Error {
  readonly code: CompaniesApiErrorCode;
  readonly status: number | null;
  constructor(code: CompaniesApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "CompaniesApiError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Lenient response schemas

const str = z
  .union([z.string(), z.number()])
  .nullish()
  .catch(null)
  .transform((v) => (v === null || v === undefined ? null : String(v)));

/** Numbers may come as strings ("47.2184"); "" / garbage → null. */
const num = z
  .union([z.string(), z.number()])
  .nullish()
  .catch(null)
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

const bool = z
  .boolean()
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

const establishmentSchema = z.looseObject({
  siret: str,
  adresse: str,
  code_postal: str,
  libelle_commune: str,
  latitude: num,
  longitude: num,
  coordonnees: str,
  est_siege: bool,
  etat_administratif: str,
  activite_principale: str,
  tranche_effectif_salarie: str,
  nom_commercial: str,
  liste_enseignes: z.array(z.string()).nullish().catch(null),
});
export type ApiEstablishment = z.infer<typeof establishmentSchema>;

const dirigeantSchema = z.looseObject({
  nom: str,
  prenoms: str,
  qualite: str,
  type_dirigeant: str,
});
export type ApiDirigeant = z.infer<typeof dirigeantSchema>;

const itemList = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .nullish()
    .catch(null)
    .transform((list) =>
      (list ?? []).flatMap((v) => {
        const r = item.safeParse(v);
        return r.success ? [r.data as z.output<T>] : [];
      }),
    );

export const companyResultSchema = z.looseObject({
  siren: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  nom_complet: str,
  nom_raison_sociale: str,
  sigle: str,
  nombre_etablissements_ouverts: num,
  siege: establishmentSchema.nullish().catch(null),
  activite_principale: str,
  activite_principale_naf25: str,
  categorie_entreprise: str,
  etat_administratif: str,
  tranche_effectif_salarie: str,
  date_creation: str,
  nature_juridique: str,
  dirigeants: itemList(dirigeantSchema),
  matching_etablissements: itemList(establishmentSchema),
  complements: z
    .looseObject({
      est_association: bool,
      est_entrepreneur_individuel: bool,
      est_service_public: bool,
    })
    .nullish()
    .catch(null),
});
export type CompanyResult = z.infer<typeof companyResultSchema>;

const responseSchema = z.looseObject({
  results: z.array(z.unknown()).catch([]),
  total_results: num,
  page: num,
  per_page: num,
  total_pages: num,
});

export type CompaniesPage = {
  results: CompanyResult[];
  total_results: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export function parseCompaniesResponse(body: unknown): CompaniesPage {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new CompaniesApiError("invalid_response", "Unexpected response shape");
  }
  const results = parsed.data.results.flatMap((r) => {
    const item = companyResultSchema.safeParse(r);
    return item.success && /^\d{9}$/.test(item.data.siren) ? [item.data] : [];
  });
  return {
    results,
    total_results: parsed.data.total_results ?? results.length,
    page: parsed.data.page ?? 1,
    per_page: parsed.data.per_page ?? results.length,
    total_pages: parsed.data.total_pages ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Request parameters (names follow the API)

export type NearPointParams = {
  lat: number;
  long: number;
  /** km */
  radius: number;
  activite_principale?: string[];
  section_activite_principale?: string[];
  limite_matching_etablissements?: number;
  minimal?: boolean;
  include?: string[];
  page?: number;
  per_page?: number;
  page_etablissements?: number;
  sort_by_size?: boolean;
};

export type SearchCompaniesParams = {
  q?: string;
  activite_principale?: string[];
  section_activite_principale?: string[];
  code_postal?: string[];
  code_commune?: string[];
  departement?: string[];
  region?: string[];
  etat_administratif?: "A" | "C";
  tranche_effectif_salarie?: string[];
  categorie_entreprise?: ("PME" | "ETI" | "GE")[];
  est_association?: boolean;
  est_administration?: boolean;
  est_entrepreneur_individuel?: boolean;
  limite_matching_etablissements?: number;
  minimal?: boolean;
  include?: string[];
  page?: number;
  per_page?: number;
  sort_by_size?: boolean;
};

type QueryValue = string | number | boolean | string[] | undefined | null;

export function buildQuery(params: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) qs.set(key, value.join(","));
    } else if (typeof value === "boolean") {
      qs.set(key, value ? "true" : "false");
    } else if (value !== "") {
      qs.set(key, String(value));
    }
  }
  return qs.toString();
}

// ---------------------------------------------------------------------------
// Limiter

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Max `maxConcurrent` tasks in flight, starts spaced by at least `minIntervalMs`. */
export class RateLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private nextStartAt = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxConcurrent: number,
    private readonly sleep: Sleep = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.maxConcurrent) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve)); // slot handed over

    const t = this.now();
    const startAt = Math.max(t, this.nextStartAt);
    this.nextStartAt = startAt + this.minIntervalMs;
    try {
      if (startAt > t) await this.sleep(startAt - t);
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

// ---------------------------------------------------------------------------
// Client

export type CompaniesClientOptions = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number[];
  minIntervalMs?: number;
  maxConcurrent?: number;
  sleep?: Sleep;
};

export type CompaniesClient = {
  searchNearPoint(params: NearPointParams): Promise<CompaniesPage>;
  searchCompanies(params: SearchCompaniesParams): Promise<CompaniesPage>;
};

const isRetryable = (e: CompaniesApiError) =>
  e.code === "rate_limited" ||
  e.code === "timeout" ||
  e.code === "network" ||
  (e.code === "http_error" && (e.status ?? 0) >= 500);

export function createCompaniesClient(opts: CompaniesClientOptions = {}): CompaniesClient {
  const baseUrl = (opts.baseUrl ?? COMPANIES_API_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? realSleep;
  const limiter = new RateLimiter(
    opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    sleep,
  );

  async function once(url: string): Promise<CompaniesPage> {
    const doFetch = opts.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      throw controller.signal.aborted
        ? new CompaniesApiError("timeout", `Request timed out after ${timeoutMs} ms`)
        : new CompaniesApiError("network", "Network error");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new CompaniesApiError("rate_limited", "HTTP 429", 429);
    if (res.status === 400) {
      let detail = "";
      try {
        const body = (await res.json()) as { erreur?: unknown };
        if (typeof body?.erreur === "string") detail = `: ${body.erreur.slice(0, 200)}`;
      } catch {
        // ignore
      }
      throw new CompaniesApiError("bad_request", `HTTP 400${detail}`, 400);
    }
    if (!res.ok) throw new CompaniesApiError("http_error", `HTTP ${res.status}`, res.status);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CompaniesApiError("invalid_response", "Response is not JSON", res.status);
    }
    return parseCompaniesResponse(body);
  }

  async function get(path: string, params: Record<string, QueryValue>): Promise<CompaniesPage> {
    const url = `${baseUrl}${path}?${buildQuery(params)}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await limiter.schedule(() => once(url));
      } catch (e) {
        if (!(e instanceof CompaniesApiError) || !isRetryable(e) || attempt >= maxRetries) throw e;
        await sleep(backoff[Math.min(attempt, backoff.length - 1)] ?? 1000);
      }
    }
  }

  const perPage = (n: number | undefined) =>
    Math.min(MAX_PER_PAGE, Math.max(1, Math.round(n ?? MAX_PER_PAGE)));

  return {
    searchNearPoint: (p) => get("/near_point", { ...p, per_page: perPage(p.per_page) }),
    searchCompanies: (p) => get("/search", { ...p, per_page: perPage(p.per_page) }),
  };
}

let defaultClient: CompaniesClient | undefined;

/** Process-wide client: one limiter shared by every search running on this instance. */
export function getCompaniesClient(): CompaniesClient {
  defaultClient ??= createCompaniesClient();
  return defaultClient;
}

export function searchNearPoint(
  params: NearPointParams,
  client: CompaniesClient = getCompaniesClient(),
): Promise<CompaniesPage> {
  return client.searchNearPoint(params);
}

export function searchCompanies(
  params: SearchCompaniesParams,
  client: CompaniesClient = getCompaniesClient(),
): Promise<CompaniesPage> {
  return client.searchCompanies(params);
}

// ---------------------------------------------------------------------------
// Normalization

const MANAGER_ROLE =
  /(pr[ée]sident|directeur|directrice|g[ée]rant|\bpdg\b|\bdg\b|managing director|dirigeant)/i;
const NON_MANAGER_ROLE =
  /(commissaire|administrat(eur|rice)|membre|surveillance|censeur|liquidat|mandataire|repr[ée]sentant|contr[ôo]leur)/i;
const MAX_LEADERS = 5;

function capitalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function isManagerialRole(qualite: string | null): boolean {
  return !!qualite && MANAGER_ROLE.test(qualite) && !NON_MANAGER_ROLE.test(qualite);
}

/** Natural persons with a managerial role only; {first_name, last_name, role}. */
export function normalizeLeaders(dirigeants: readonly ApiDirigeant[]): Leader[] {
  const out: Leader[] = [];
  for (const d of dirigeants) {
    if (d.type_dirigeant && d.type_dirigeant !== "personne physique") continue;
    if (!isManagerialRole(d.qualite)) continue;
    const first = (d.prenoms ?? "").trim().split(/\s+/)[0] ?? "";
    const last = (d.nom ?? "").trim();
    if (!first || !last) continue;
    const leader = {
      first_name: capitalizeName(first),
      last_name: capitalizeName(last),
      role: (d.qualite ?? "").trim().slice(0, 100),
    };
    if (out.some((l) => l.first_name === leader.first_name && l.last_name === leader.last_name)) {
      continue;
    }
    out.push(leader);
    if (out.length >= MAX_LEADERS) break;
  }
  return out;
}

function pointOf(e: ApiEstablishment): GeoPoint | null {
  if (e.latitude !== null && e.longitude !== null) {
    const p = { lat: e.latitude, lng: e.longitude };
    return isValidPoint(p) ? p : null;
  }
  if (e.coordonnees) {
    const [lat, lng] = e.coordonnees.split(",").map((v) => Number(v.trim()));
    const p = { lat, lng };
    return isValidPoint(p) ? p : null;
  }
  return null;
}

function toEstablishment(e: ApiEstablishment, origin: GeoPoint | undefined): Establishment {
  const point = pointOf(e);
  return {
    siret: e.siret,
    address: e.adresse,
    postal_code: e.code_postal,
    city: e.libelle_commune,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    distance_km: point && origin ? roundKm(haversineKm(origin, point)) : null,
  };
}

/** Nearest open matching establishment (or the HQ when there is none). */
export function pickEstablishment(result: CompanyResult, origin?: GeoPoint): Establishment | null {
  const open = result.matching_etablissements.filter((e) => e.etat_administratif !== "F");
  const pool = open.length > 0 ? open : result.matching_etablissements;
  const candidates = pool.map((e) => toEstablishment(e, origin));
  if (candidates.length === 0) return result.siege ? toEstablishment(result.siege, origin) : null;
  if (!origin) return candidates[0];
  return candidates.reduce((best, c) =>
    c.distance_km !== null && (best.distance_km === null || c.distance_km < best.distance_km)
      ? c
      : best,
  );
}

const CATEGORIES = ["PME", "ETI", "GE"] as const;

export function normalizeCompany(result: CompanyResult, origin?: GeoPoint): NormalizedCompany {
  const nafCode = normalizeNafCode(result.activite_principale);
  const headcountCode = normalizeHeadcountCode(result.tranche_effectif_salarie);
  const category = CATEGORIES.find((c) => c === result.categorie_entreprise) ?? null;
  const isIndividual =
    result.complements?.est_entrepreneur_individuel === true || result.nature_juridique === "1000";
  const establishment = pickEstablishment(
    result,
    origin && isValidPoint(origin) ? origin : undefined,
  );
  const name =
    (result.nom_complet ?? result.nom_raison_sociale ?? "").trim() || `Entreprise ${result.siren}`;

  return {
    siren: result.siren,
    name: name.slice(0, 200),
    naf_code: nafCode,
    naf_label: nafLabel(nafCode),
    headcount_code: headcountCode,
    headcount_label: headcountLabel(headcountCode),
    headcount_min: headcountMin(headcountCode),
    category,
    is_active: result.etat_administratif === "A",
    is_association: result.complements?.est_association === true,
    is_individual: isIndividual,
    leaders: normalizeLeaders(result.dirigeants),
    raw_minimal: {
      siren: result.siren,
      nom_complet: result.nom_complet,
      sigle: result.sigle,
      activite_principale: result.activite_principale,
      activite_principale_naf25: result.activite_principale_naf25,
      categorie_entreprise: result.categorie_entreprise,
      tranche_effectif_salarie: result.tranche_effectif_salarie,
      etat_administratif: result.etat_administratif,
      nature_juridique: result.nature_juridique,
      date_creation: result.date_creation,
      nombre_etablissements_ouverts: result.nombre_etablissements_ouverts,
      siege: result.siege
        ? {
            siret: result.siege.siret,
            code_postal: result.siege.code_postal,
            libelle_commune: result.siege.libelle_commune,
          }
        : null,
      est_association: result.complements?.est_association ?? null,
      est_entrepreneur_individuel: result.complements?.est_entrepreneur_individuel ?? null,
    },
    establishment,
  };
}
