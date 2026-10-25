/**
 * Hunter search orchestration (SPEC §7.1–7.3). SERVER ONLY.
 *
 *   startSearch  → creates the `searches` row (status running) and returns its id.
 *   runSearch    → profile → map_naf → geocode → API → pre-filter → score_fit →
 *                  companies (service role) + leads (user client). Never throws:
 *                  failures end as status "failed" with a French, user-safe `error`.
 *                  Meant to run in `after()` from a Server Function / Route Handler.
 *
 * Never logs profile data, company lists or LLM output (only codes and counts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logEvent } from "@/lib/events";
import {
  CompaniesApiError,
  getCompaniesClient,
  normalizeCompany,
  type CompaniesClient,
} from "@/lib/integrations/companies";
import {
  geocodeCity,
  departementFromPostcode,
  extractPostcode,
  type GeocodeResult,
} from "@/lib/integrations/geocode";
import type { LlmProvider, LlmUsageEvent } from "@/lib/llm/client";
import type { ScoreFitProfile } from "@/lib/llm/prompts/score-fit";
import { loadEditableProfile } from "@/lib/profile/service";
import type { EditableProfile } from "@/lib/profile/schema";
import { createAdminClient } from "@/lib/supabase/admin";

import { fetchCandidates } from "./fetch-candidates";
import {
  headcountLabel,
  headcountMin,
  matchesSizeFilter,
  normalizeHeadcountCode,
  sizeBucket,
} from "./headcount";
import { mapRolesToNaf } from "./map-naf";
import { prefilterCompanies } from "./prefilter";
import { scoreCompanies, type ScoredCompany } from "./scoring";
import {
  hunterSearchParamsSchema,
  sizeFilterSchema,
  type HunterSearchParams,
  type LeadStatus,
  type NormalizedCompany,
  type SearchProgress,
  type SearchStatusValue,
  type SizeBucket,
  type SizeFilter,
} from "./types";

export {
  defaultParamsFromProfile,
  hunterSearchParamsSchema,
  type HunterSearchParams,
} from "./types";

/** SPEC §7.2: "On affiche les 30 meilleures". */
export const MAX_LEADS_PER_SEARCH = 30;

// ---------------------------------------------------------------------------
// Errors

export type HunterErrorCode =
  | "invalid_params"
  | "search_not_found"
  | "missing_service_role"
  | "geocode_failed"
  | "api_unavailable"
  | "database"
  | "unexpected";

const USER_MESSAGES: Record<HunterErrorCode, string> = {
  invalid_params: "Les critères de recherche sont invalides.",
  search_not_found: "Recherche introuvable.",
  missing_service_role:
    "Configuration serveur incomplète : la recherche d'entreprises n'est pas encore activée sur ce serveur. Préviens l'administrateur de la plateforme.",
  geocode_failed:
    "Impossible de localiser ta ville. Vérifie son orthographe ou ajoute le code postal (ex. « 44000 Nantes »).",
  api_unavailable:
    "Le service public de recherche d'entreprises ne répond pas pour le moment. Réessaie dans quelques minutes.",
  database: "La recherche n'a pas pu être enregistrée. Réessaie dans quelques minutes.",
  unexpected:
    "La recherche a échoué à cause d'une erreur inattendue. Réessaie dans quelques minutes.",
};

export class HunterError extends Error {
  readonly code: HunterErrorCode;
  /** French, safe to show to the user. */
  readonly userMessage: string;
  constructor(code: HunterErrorCode, userMessage?: string, options?: { cause?: unknown }) {
    super(`hunter: ${code}`, options);
    this.name = "HunterError";
    this.code = code;
    this.userMessage = userMessage ?? USER_MESSAGES[code];
  }
}

const dbError = (what: string, error: { code?: string } | null) => {
  console.error(`[hunter] ${what} failed (${error?.code ?? "unknown"})`);
  return new HunterError("database");
};

// ---------------------------------------------------------------------------
// startSearch

const INITIAL_PROGRESS: SearchProgress = { step: "naf", done: 0, total: 1 };

/**
 * Validates the params and creates a `searches` row (status running).
 * Throws HunterError("invalid_params", <French message>) or HunterError("database").
 */
export async function startSearch(
  supabase: SupabaseClient,
  userId: string,
  params: HunterSearchParams,
): Promise<string> {
  const parsed = hunterSearchParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new HunterError("invalid_params", parsed.error.issues[0]?.message ?? undefined);
  }
  const { data, error } = await supabase
    .from("searches")
    .insert({ user_id: userId, params: parsed.data, status: "running", progress: INITIAL_PROGRESS })
    .select("id")
    .single();
  if (error || !data) throw dbError("searches insert", error);
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// runSearch

export type RunSearchDeps = {
  companiesClient?: CompaniesClient;
  geocode?: (city: string) => Promise<GeocodeResult | null>;
  llmProvider?: LlmProvider;
  now?: () => number;
};

export type RunSearchResult =
  | { status: "done"; resultsCount: number }
  | { status: "failed"; error: string; code: HunterErrorCode };

/** Leads drafted/sent or with an application → SIRENs never proposed again (SPEC §7). */
export async function loadContactedSirens(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data: contactedLeads, error: e1 } = await supabase
    .from("leads")
    .select("company_id")
    .eq("user_id", userId)
    .in("status", ["drafted", "sent"]);
  if (e1) throw dbError("contacted leads select", e1);

  const { data: apps, error: e2 } = await supabase
    .from("applications")
    .select("lead_id")
    .eq("user_id", userId);
  if (e2) throw dbError("applications select", e2);

  const companyIds = new Set(
    (contactedLeads ?? []).map((l) => (l as { company_id: string }).company_id),
  );
  const leadIds = [...new Set((apps ?? []).map((a) => (a as { lead_id: string }).lead_id))];
  if (leadIds.length > 0) {
    const { data: appLeads, error: e3 } = await supabase
      .from("leads")
      .select("company_id")
      .eq("user_id", userId)
      .in("id", leadIds);
    if (e3) throw dbError("application leads select", e3);
    for (const l of appLeads ?? []) companyIds.add((l as { company_id: string }).company_id);
  }
  if (companyIds.size === 0) return new Set();

  const { data: companies, error: e4 } = await supabase
    .from("companies")
    .select("siren")
    .in("id", [...companyIds]);
  if (e4) throw dbError("contacted companies select", e4);
  return new Set((companies ?? []).map((c) => (c as { siren: string }).siren));
}

function scoreFitProfile(profile: EditableProfile, params: HunterSearchParams): ScoreFitProfile {
  // Deliberately no name, e-mail, phone, address or pitch.
  return {
    roles: params.roles,
    sectors: params.sectors,
    skills: profile.skills.slice(0, 25),
    degree: profile.degree,
    contract_type: params.contract_type,
    city: params.city,
    experience_titles: profile.experiences.map((e) => e.title).slice(0, 5),
  };
}

function companyRow(c: NormalizedCompany) {
  // Only API-sourced columns: enrichment columns (website, domain, enriched_at) are left untouched.
  return {
    siren: c.siren,
    name: c.name,
    naf_code: c.naf_code,
    naf_label: c.naf_label,
    headcount_range: c.headcount_code,
    address: c.establishment?.address ?? null,
    postal_code: c.establishment?.postal_code ?? null,
    city: c.establishment?.city ?? null,
    lat: c.establishment?.lat ?? null,
    lng: c.establishment?.lng ?? null,
    leaders: c.leaders,
    raw: c.raw_minimal,
  };
}

function leadRow(c: ScoredCompany, userId: string, searchId: string, companyId: string) {
  // `status` is omitted on purpose: new rows get 'suggested', existing rows keep theirs.
  return {
    user_id: userId,
    search_id: searchId,
    company_id: companyId,
    fit_score: c.fit_score,
    fit_reasons: c.fit_reasons,
    prefilter_score: c.prefilter_score,
    distance_km: c.establishment?.distance_km ?? null,
    establishment_siret: c.establishment?.siret ?? null,
    establishment_address: c.establishment?.address ?? null,
    establishment_city: c.establishment?.city ?? null,
    establishment_lat: c.establishment?.lat ?? null,
    establishment_lng: c.establishment?.lng ?? null,
  };
}

function resolveAdmin(admin: SupabaseClient | null | undefined): SupabaseClient | null {
  if (admin) return admin;
  if (admin === null) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

async function locate(
  city: string,
  geocode: (city: string) => Promise<GeocodeResult | null>,
): Promise<{ origin: { lat: number; lng: number } | null; departement: string | null }> {
  const geo = await geocode(city);
  if (geo) return { origin: { lat: geo.lat, lng: geo.lng }, departement: geo.departement };
  return { origin: null, departement: departementFromPostcode(extractPostcode(city)) };
}

/**
 * Runs a search created by startSearch. `supabase` is the signed-in user's client
 * (RLS), `admin` the service-role client used ONLY to write the shared `companies`
 * cache. Pass `undefined` to create it from SUPABASE_SERVICE_ROLE_KEY, `null` when
 * it is unavailable (the search then fails with a clear message).
 * Re-running the same search id does not duplicate leads.
 */
export async function runSearch(
  supabase: SupabaseClient,
  admin: SupabaseClient | null | undefined,
  searchId: string,
  userId: string,
  deps: RunSearchDeps = {},
): Promise<RunSearchResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  let progress: SearchProgress = INITIAL_PROGRESS;
  let writes: Promise<void> = Promise.resolve();

  /** Serialized progress writes; failures are only logged. */
  const setProgress = (next: SearchProgress, extra: Record<string, unknown> = {}) => {
    progress = next;
    writes = writes.then(async () => {
      const { error } = await supabase
        .from("searches")
        .update({ progress: next, ...extra })
        .eq("id", searchId)
        .eq("user_id", userId);
      if (error) console.warn(`[hunter] progress update failed (${error.code ?? "unknown"})`);
    });
    return writes;
  };

  const onUsage = (usage: LlmUsageEvent) =>
    logEvent(supabase, userId, "llm_usage", {
      prompt: usage.promptName,
      prompt_version: usage.promptVersion,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      attempts: usage.attempts,
      success: usage.success,
    });

  try {
    const { data: search, error: searchError } = await supabase
      .from("searches")
      .select("id, params")
      .eq("id", searchId)
      .eq("user_id", userId)
      .maybeSingle();
    if (searchError) throw dbError("searches select", searchError);
    if (!search) throw new HunterError("search_not_found");

    const parsedParams = hunterSearchParamsSchema.safeParse((search as { params: unknown }).params);
    if (!parsedParams.success) throw new HunterError("invalid_params");
    const params = parsedParams.data;

    const adminClient = resolveAdmin(admin);
    if (!adminClient) {
      console.error("[hunter] search failed: missing_service_role");
      throw new HunterError("missing_service_role");
    }

    await logEvent(supabase, userId, "search_started", {
      radius_km: params.radius_km,
      roles_count: params.roles.length,
      sectors_count: params.sectors.length,
      contract_type: params.contract_type,
      size: params.size,
    });
    await setProgress({ step: "naf", done: 0, total: 1 }, { status: "running", error: null });

    // 1. NAF codes
    const { profile } = await loadEditableProfile(supabase, userId);
    const naf = await mapRolesToNaf(
      {
        roles: params.roles,
        sectors: params.sectors,
        skills: profile.skills,
        degree: profile.degree,
      },
      { provider: deps.llmProvider, onUsage },
    );
    const nafCodes = naf.codes.map((c) => c.code);
    await setProgress(
      { step: "fetch", done: 0, total: 1 },
      { params: { ...params, naf_codes: nafCodes, naf_source: naf.source } },
    );

    // 2. Geocoding + API
    const { origin, departement } = await locate(
      params.city,
      deps.geocode ?? ((c) => geocodeCity(c)),
    );
    if (!origin && !departement) throw new HunterError("geocode_failed");

    let fetched;
    try {
      fetched = await fetchCandidates(
        deps.companiesClient ?? getCompaniesClient(),
        { origin, departement, radiusKm: params.radius_km, nafCodes, size: params.size },
        (done, total) => {
          void setProgress({ step: "fetch", done, total });
        },
      );
    } catch (e) {
      const code = e instanceof CompaniesApiError ? e.code : "unknown";
      console.error(`[hunter] companies API failed (${code})`);
      throw new HunterError("api_unavailable", undefined, { cause: e });
    }

    const nearest = new Map<string, NormalizedCompany>();
    for (const r of fetched.results) {
      const c = normalizeCompany(r, origin ?? undefined);
      nearest.set(c.siren, c);
    }

    // 3. Pre-filter
    await setProgress({ step: "prefilter", done: 0, total: nearest.size });
    const contacted = await loadContactedSirens(supabase, userId);
    const pre = prefilterCompanies([...nearest.values()], {
      radiusKm: params.radius_km,
      nafCodes,
      contactedSirens: contacted,
      size: params.size,
      contractType: params.contract_type,
    });

    // 4. LLM scoring
    const batches = Math.ceil(pre.kept.length / 10);
    await setProgress({ step: "scoring", done: 0, total: batches });
    const { scored, failedBatches } = await scoreCompanies(
      scoreFitProfile(profile, params),
      pre.kept,
      {
        provider: deps.llmProvider,
        onUsage,
        onBatchDone: (done, total) => setProgress({ step: "scoring", done, total }),
      },
    );
    const top = [...scored]
      .sort(
        (a, b) =>
          b.fit_score - a.fit_score ||
          b.prefilter_score - a.prefilter_score ||
          a.siren.localeCompare(b.siren),
      )
      .slice(0, MAX_LEADS_PER_SEARCH);

    // 5. Persist: shared cache (service role), then the user's leads (RLS).
    let resultsCount = 0;
    if (top.length > 0) {
      const { data: companyIds, error: cErr } = await adminClient
        .from("companies")
        .upsert(top.map(companyRow), { onConflict: "siren" })
        .select("id, siren");
      if (cErr || !companyIds) throw dbError("companies upsert", cErr);
      const idBySiren = new Map(
        (companyIds as { id: string; siren: string }[]).map((r) => [r.siren, r.id]),
      );

      const rows = top.flatMap((c) => {
        const id = idBySiren.get(c.siren);
        return id ? [leadRow(c, userId, searchId, id)] : [];
      });
      const { data: leads, error: lErr } = await supabase
        .from("leads")
        .upsert(rows, { onConflict: "user_id,company_id" })
        .select("id");
      if (lErr) throw dbError("leads upsert", lErr);
      resultsCount = leads?.length ?? rows.length;
    }

    await setProgress(
      { step: "done", done: resultsCount, total: resultsCount },
      { status: "done", results_count: resultsCount, error: null },
    );
    await logEvent(supabase, userId, "search_done", {
      results_count: resultsCount,
      duration_ms: now() - started,
      naf_count: nafCodes.length,
      naf_source: naf.source,
      fetched_count: nearest.size,
      api_requests: fetched.requests,
      prefilter_kept: pre.kept.length,
      llm_failed_batches: failedBatches,
      geocoded: origin !== null,
    });
    return { status: "done", resultsCount };
  } catch (e) {
    const err =
      e instanceof HunterError ? e : new HunterError("unexpected", undefined, { cause: e });
    if (!(e instanceof HunterError)) {
      console.error(
        `[hunter] search failed: unexpected (${e instanceof Error ? e.name : "unknown"})`,
      );
    }
    if (err.code !== "search_not_found") {
      await setProgress(progress, { status: "failed", error: err.userMessage });
      await logEvent(supabase, userId, "search_failed", {
        code: err.code,
        step: progress.step,
        duration_ms: now() - started,
      });
    }
    return { status: "failed", error: err.userMessage, code: err.code };
  }
}

// ---------------------------------------------------------------------------
// Read side (for the UI)

export type SearchStatus = {
  id: string;
  status: SearchStatusValue;
  progress: SearchProgress;
  error: string | null;
  results_count: number;
  params: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const progressSchema = z.object({
  step: z.enum(["naf", "fetch", "prefilter", "scoring", "done"]).catch("naf"),
  done: z.number().catch(0),
  total: z.number().catch(0),
});

/** Status of one search (RLS: only the owner's searches are visible). null if not found. */
export async function getSearchStatus(
  supabase: SupabaseClient,
  searchId: string,
): Promise<SearchStatus | null> {
  const { data, error } = await supabase
    .from("searches")
    .select("id, status, progress, error, results_count, params, created_at, updated_at")
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw dbError("searches select", error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const p = progressSchema.safeParse(row.progress);
  return {
    id: String(row.id),
    status: (["running", "done", "failed"].includes(row.status as string)
      ? row.status
      : "running") as SearchStatusValue,
    progress: p.success ? p.data : { step: "naf", done: 0, total: 0 },
    error: typeof row.error === "string" ? row.error : null,
    results_count: typeof row.results_count === "number" ? row.results_count : 0,
    params:
      row.params && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export type LeadFilters = { minScore?: number; size?: SizeFilter; maxDistanceKm?: number };

/** Card-ready lead (SPEC §7.3). */
export type LeadCard = {
  id: string;
  company_id: string;
  siren: string;
  name: string;
  naf_code: string | null;
  naf_label: string | null;
  city: string | null;
  address: string | null;
  headcount_code: string | null;
  headcount_label: string;
  size: SizeBucket | null;
  distance_km: number | null;
  fit_score: number | null;
  fit_reasons: string[];
  prefilter_score: number | null;
  status: LeadStatus;
};

const LEAD_COLUMNS =
  "id, company_id, status, fit_score, fit_reasons, prefilter_score, distance_km, " +
  "establishment_address, establishment_city, " +
  "company:companies(siren, name, naf_code, naf_label, headcount_range, city, address)";

type LeadJoinRow = {
  id: string;
  company_id: string;
  status: LeadStatus;
  fit_score: number | null;
  fit_reasons: string[] | null;
  prefilter_score: number | null;
  distance_km: number | null;
  establishment_address: string | null;
  establishment_city: string | null;
  company: {
    siren: string;
    name: string;
    naf_code: string | null;
    naf_label: string | null;
    headcount_range: string | null;
    city: string | null;
    address: string | null;
  } | null;
};

/** Leads of one search, best score first. Distance filter excludes unknown distances. */
export async function listLeads(
  supabase: SupabaseClient,
  userId: string,
  searchId: string,
  filters: LeadFilters = {},
): Promise<LeadCard[]> {
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("user_id", userId)
    .eq("search_id", searchId);
  if (typeof filters.minScore === "number") query = query.gte("fit_score", filters.minScore);
  if (typeof filters.maxDistanceKm === "number") {
    query = query.lte("distance_km", filters.maxDistanceKm);
  }
  const { data, error } = await query
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw dbError("leads select", error);

  const size = sizeFilterSchema.catch("any").parse(filters.size ?? "any");
  return ((data ?? []) as unknown as LeadJoinRow[])
    .flatMap((l): LeadCard[] => {
      if (!l.company) return [];
      const code = normalizeHeadcountCode(l.company.headcount_range);
      const min = headcountMin(code);
      if (!matchesSizeFilter(min, size)) return [];
      return [
        {
          id: l.id,
          company_id: l.company_id,
          siren: l.company.siren,
          name: l.company.name,
          naf_code: l.company.naf_code,
          naf_label: l.company.naf_label,
          city: l.establishment_city ?? l.company.city,
          address: l.establishment_address ?? l.company.address,
          headcount_code: code,
          headcount_label: headcountLabel(code),
          size: sizeBucket(min),
          distance_km: l.distance_km,
          fit_score: l.fit_score,
          fit_reasons: l.fit_reasons ?? [],
          prefilter_score: l.prefilter_score,
          status: l.status,
        },
      ];
    })
    .sort(
      (a, b) =>
        (b.fit_score ?? -1) - (a.fit_score ?? -1) ||
        (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity),
    );
}

const setLeadStatusSchema = z.object({
  leadIds: z.array(z.uuid()).min(1).max(200),
  status: z.enum(["selected", "dismissed", "suggested"]),
});

/**
 * Selects / dismisses / resets leads. Leads already drafted or sent are never
 * changed. Returns the number of updated leads.
 */
export async function setLeadStatus(
  supabase: SupabaseClient,
  userId: string,
  leadIds: string[],
  status: "selected" | "dismissed" | "suggested",
): Promise<number> {
  const parsed = setLeadStatusSchema.safeParse({ leadIds: [...new Set(leadIds)], status });
  if (!parsed.success) throw new HunterError("invalid_params");
  const { data, error } = await supabase
    .from("leads")
    .update({ status: parsed.data.status })
    .eq("user_id", userId)
    .in("id", parsed.data.leadIds)
    .in("status", ["suggested", "selected", "dismissed"])
    .select("id");
  if (error) throw dbError("leads update", error);
  return data?.length ?? 0;
}
