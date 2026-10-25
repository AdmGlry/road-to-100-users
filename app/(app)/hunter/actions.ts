"use server";

/**
 * Server Actions of the hunter screen (SPEC §7.1–7.3).
 *
 * Every action re-reads the signed-in user from the Supabase session
 * (cookies): a user id is never accepted from the client. The user's
 * Supabase client is used for every read and write, so RLS applies; the
 * service-role client is only handed to the background search job.
 * Errors are returned as French messages; only error names/codes are logged.
 */
import { after } from "next/server";
import { z } from "zod";

import {
  getSearchStatus,
  HunterError,
  listLeads,
  runSearch,
  setLeadStatus,
  startSearch,
} from "@/lib/hunter/search";
import { hunterSearchParamsSchema, type HunterSearchParams } from "@/lib/hunter/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SESSION_EXPIRED = "Ta session a expiré. Reconnecte-toi puis réessaie.";
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const INVALID_PARAMS =
  "Certains critères ne sont pas valides : indique au moins un poste ou un secteur visé, une ville et un rayon entre 5 et 100 km.";
const NOT_CONFIGURED =
  "La recherche d'entreprises n'est pas encore configurée sur ce serveur. Contacte l'administrateur de Spontané.";
const SEARCH_NOT_FOUND = "Cette recherche est introuvable. Lance une nouvelle recherche.";

/** A running search younger than this is resumed instead of starting a second one. */
const RESUME_RUNNING_MS = 5 * 60 * 1000;

export type Lead = Awaited<ReturnType<typeof listLeads>>[number];
export type SearchStatus = NonNullable<Awaited<ReturnType<typeof getSearchStatus>>>;
export type LeadFiltersInput = Parameters<typeof listLeads>[3];

export type StartSearchResult =
  { ok: true; searchId: string; resumed: boolean } | { ok: false; message: string };
export type SearchStatusResult =
  { ok: true; search: SearchStatus } | { ok: false; message: string };
export type ListLeadsResult = { ok: true; leads: Lead[] } | { ok: false; message: string };
export type SetLeadStatusResult = { ok: true } | { ok: false; message: string };
export type LatestSearch = {
  id: string;
  status: SearchStatus["status"];
  params: HunterSearchParams | null;
  results_count: number;
  created_at: string;
};
export type LatestSearchResult =
  { ok: true; search: LatestSearch | null } | { ok: false; message: string };

const searchIdSchema = z.uuid();
const leadIdsSchema = z.array(z.uuid()).min(1).max(100);
const leadStatusSchema = z.enum(["selected", "dismissed", "suggested"]);
const filtersSchema = z
  .object({
    minScore: z.number().int().min(0).max(100).optional(),
    size: z.enum(["any", "small", "medium", "large"]).optional(),
    maxDistanceKm: z.number().min(0).max(1000).optional(),
  })
  .strict();

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

/** Logs a failure without its message (it could quote profile or company data). */
function logFailure(action: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`[hunter] ${action} failed`, {
    name: err instanceof Error ? err.name : typeof err,
    code,
  });
}

async function readLatestSearch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<LatestSearch | null> {
  const { data, error } = await supabase
    .from("searches")
    .select("id, status, params, results_count, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`searches select failed (${error.code ?? "unknown"})`);
  if (!data) return null;

  const params = hunterSearchParamsSchema.safeParse(data.params);
  return {
    id: String(data.id),
    status: data.status as SearchStatus["status"],
    params: params.success ? params.data : null,
    results_count: typeof data.results_count === "number" ? data.results_count : 0,
    created_at: String(data.created_at),
  };
}

/**
 * Creates the search row and returns immediately; the long work (NAF
 * mapping, company fetch, LLM scoring ≈ 20–60 s) runs in `after()`, i.e.
 * after the response is sent, within the page's maxDuration (300 s).
 */
export async function startSearchAction(params: HunterSearchParams): Promise<StartSearchResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const { supabase, user } = session;

  const parsed = hunterSearchParamsSchema.safeParse(params);
  if (!parsed.success) {
    // The schema's messages are written in French for the student.
    const first = parsed.error.issues[0];
    const french =
      first &&
      (first.code === "custom" || first.path[0] === "city" || first.path[0] === "radius_km") &&
      first.code !== "invalid_type";
    const message = french ? first.message : INVALID_PARAMS;
    return { ok: false, message };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    logFailure("startSearch.adminClient", err);
    return { ok: false, message: NOT_CONFIGURED };
  }

  try {
    // Double click / second tab: resume the search already running.
    const latest = await readLatestSearch(supabase, user.id);
    if (
      latest?.status === "running" &&
      Date.now() - Date.parse(latest.created_at) < RESUME_RUNNING_MS
    ) {
      return { ok: true, searchId: latest.id, resumed: true };
    }

    const searchId = await startSearch(supabase, user.id, parsed.data);

    after(async () => {
      try {
        await runSearch(supabase, admin, searchId, user.id);
      } catch (err) {
        logFailure("runSearch", err);
        // Safety net: never leave a search "running" forever if the job crashed.
        const { error } = await admin
          .from("searches")
          .update({ status: "failed" })
          .eq("id", searchId)
          .eq("user_id", user.id)
          .eq("status", "running");
        if (error) logFailure("runSearch.markFailed", error);
      }
    });

    return { ok: true, searchId, resumed: false };
  } catch (err) {
    logFailure("startSearch", err);
    if (err instanceof HunterError) return { ok: false, message: err.userMessage };
    return { ok: false, message: "Impossible de lancer la recherche pour le moment. Réessaie." };
  }
}

export async function getSearchStatusAction(searchId: string): Promise<SearchStatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };

  const id = searchIdSchema.safeParse(searchId);
  if (!id.success) return { ok: false, message: SEARCH_NOT_FOUND };

  try {
    const search = await getSearchStatus(session.supabase, id.data);
    if (!search) return { ok: false, message: SEARCH_NOT_FOUND };
    return { ok: true, search };
  } catch (err) {
    logFailure("getSearchStatus", err);
    if (err instanceof HunterError) return { ok: false, message: err.userMessage };
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function listLeadsAction(
  searchId: string,
  filters: LeadFiltersInput = {},
): Promise<ListLeadsResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };

  const id = searchIdSchema.safeParse(searchId);
  const parsedFilters = filtersSchema.safeParse(filters ?? {});
  if (!id.success) return { ok: false, message: SEARCH_NOT_FOUND };
  if (!parsedFilters.success) return { ok: false, message: GENERIC_ERROR };

  try {
    const leads = await listLeads(session.supabase, session.user.id, id.data, parsedFilters.data);
    return { ok: true, leads };
  } catch (err) {
    logFailure("listLeads", err);
    return { ok: false, message: "Impossible de charger les entreprises. Réessaie." };
  }
}

export async function setLeadStatusAction(
  leadIds: string[],
  status: "selected" | "dismissed" | "suggested",
): Promise<SetLeadStatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };

  const ids = leadIdsSchema.safeParse(leadIds);
  const parsedStatus = leadStatusSchema.safeParse(status);
  if (!ids.success || !parsedStatus.success) return { ok: false, message: GENERIC_ERROR };

  try {
    await setLeadStatus(session.supabase, session.user.id, ids.data, parsedStatus.data);
    return { ok: true };
  } catch (err) {
    logFailure("setLeadStatus", err);
    return {
      ok: false,
      message: "Ton choix n'a pas été enregistré. Vérifie ta connexion puis réessaie.",
    };
  }
}

/** Most recent search of the signed-in user (so a reload resumes it). */
export async function latestSearchAction(): Promise<LatestSearchResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };

  try {
    return { ok: true, search: await readLatestSearch(session.supabase, session.user.id) };
  } catch (err) {
    logFailure("latestSearch", err);
    return { ok: false, message: GENERIC_ERROR };
  }
}
