/**
 * Preparation queue (SPEC §7.4–7.5): for each selected lead, website/domain →
 * contacts → hook → mail draft. SERVER ONLY.
 *
 * - queuePreparation (user client, RLS): marks the student's own selected
 *   leads prep_status "queued".
 * - runPreparation (service role, every query filtered by the verified user
 *   id): claims queued (or stale running) leads one by one with a conditional
 *   update on prep_status, so concurrent runs never prepare the same lead
 *   twice (the unique applications.lead_id index is the last safety net).
 *   Stops starting new leads after the deadline, never throws; a failure ends
 *   as prep_status "failed" with a French, user-safe prep_error.
 * - regenerateApplication: recomposes an unsent, unscheduled draft.
 *
 * Works without web search (WEBSEARCH_PROVIDER=none): no website → no
 * guessed address → contact null (the student types one on the review
 * screen) and an activity-based hook.
 * Logs only codes and counts (no profile values, mail text or addresses).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  MAX_PREPARE_AT_ONCE,
  PREP_STALE_MS,
  type CompanyFacts,
  type CompanyInsight,
  type ContactCandidate,
} from "@/lib/hunter/application-types";
import { logEvent } from "@/lib/events";
import { getWebSearchClient, type WebSearchClient } from "@/lib/integrations/websearch";
import { LlmJsonError, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import { loadEditableProfile } from "@/lib/profile/service";
import type { EditableProfile } from "@/lib/profile/schema";

import { composeApplication } from "./compose";
import { findContacts } from "./contacts";
import { pickOfficialWebsite, registrableDomain } from "./domains";
import { headcountLabel, headcountMin } from "./headcount";
import { findCompanyInsight } from "./research";

export const DEFAULT_PREP_DEADLINE_MS = 240_000;
export const DEFAULT_PREP_CONCURRENCY = 2;
/** LLM cost cap (SPEC §11): regenerations per user per rolling 24 h. */
export const REGEN_LIMIT_PER_24H = 30;

// ---------------------------------------------------------------------------
// Errors

export type PrepareErrorCode =
  | "invalid_params"
  | "database"
  | "profile_incomplete"
  | "lead_unavailable"
  | "company_missing"
  | "llm_failed"
  | "not_found"
  | "not_editable"
  | "regen_limit"
  | "unexpected";

const USER_MESSAGES: Record<PrepareErrorCode, string> = {
  invalid_params: "Sélection invalide.",
  database: "Impossible d'enregistrer la préparation. Réessaie dans quelques minutes.",
  profile_incomplete:
    "Complète ton profil (au moins ton nom et ta formation) avant de préparer des candidatures.",
  lead_unavailable: "Cette entreprise ne fait plus partie de ta sélection.",
  company_missing: "Les informations de cette entreprise sont introuvables.",
  llm_failed: "La rédaction par l'IA a échoué (service saturé). Réessaie dans quelques minutes.",
  not_found: "Candidature introuvable.",
  not_editable: "Ce mail est déjà en file d'envoi ou envoyé : il ne peut plus être régénéré.",
  regen_limit:
    "Tu as atteint la limite de régénérations pour aujourd'hui. Modifie le mail à la main ou réessaie demain.",
  unexpected: "La préparation a échoué à cause d'une erreur inattendue. Réessaie.",
};

export class PrepareError extends Error {
  readonly code: PrepareErrorCode;
  /** French, safe to show to the student. */
  readonly userMessage: string;
  constructor(code: PrepareErrorCode, options?: { cause?: unknown }) {
    super(`prepare: ${code}`, options);
    this.name = "PrepareError";
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

const dbError = (what: string, error: { code?: string } | null) => {
  console.error(`[prepare] ${what} failed (${error?.code ?? "unknown"})`);
  return new PrepareError("database");
};

function toPrepareError(e: unknown): PrepareError {
  if (e instanceof PrepareError) return e;
  if (e instanceof LlmJsonError) return new PrepareError("llm_failed", { cause: e });
  if (e instanceof Error && /request failed|timeout|abort/i.test(`${e.name} ${e.message}`)) {
    return new PrepareError("llm_failed", { cause: e });
  }
  console.error(`[prepare] unexpected (${e instanceof Error ? e.name : "unknown"})`);
  return new PrepareError("unexpected", { cause: e });
}

// ---------------------------------------------------------------------------
// queuePreparation

const leadIdsSchema = z.array(z.uuid()).min(1).max(200);

export async function queuePreparation(
  supabase: SupabaseClient,
  userId: string,
  leadIds: string[],
): Promise<{ queued: number }> {
  const parsed = leadIdsSchema.safeParse([...new Set(leadIds)]);
  if (!parsed.success) throw new PrepareError("invalid_params");
  const ids = parsed.data.slice(0, MAX_PREPARE_AT_ONCE);

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, status, prep_status")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw dbError("leads select", error);

  const { data: apps, error: appsError } = await supabase
    .from("applications")
    .select("lead_id")
    .eq("user_id", userId)
    .in("lead_id", ids);
  if (appsError) throw dbError("applications select", appsError);
  const withApp = new Set((apps ?? []).map((a) => (a as { lead_id: string }).lead_id));

  const eligible = ((leads ?? []) as { id: string; status: string; prep_status: string | null }[])
    .filter(
      (l) =>
        (l.status === "selected" || l.status === "drafted") &&
        !withApp.has(l.id) &&
        l.prep_status !== "queued" &&
        l.prep_status !== "running",
    )
    .map((l) => l.id);
  if (eligible.length === 0) return { queued: 0 };

  const { data: updated, error: updateError } = await supabase
    .from("leads")
    .update({ prep_status: "queued", prep_error: null, prep_started_at: null })
    .eq("user_id", userId)
    .in("id", eligible)
    .select("id");
  if (updateError) throw dbError("leads queue", updateError);
  const queued = updated?.length ?? eligible.length;
  await logEvent(supabase, userId, "preparation_queued", { count: queued });
  return { queued };
}

// ---------------------------------------------------------------------------
// runPreparation

export type PrepareDeps = {
  /** undefined → from WEBSEARCH_PROVIDER; null → no web search. */
  webSearch?: WebSearchClient | null;
  findEmailsOnWebsite?: (domain: string) => Promise<{ email: string; page: string }[]>;
  hasMxRecord?: (domain: string) => Promise<boolean>;
  provider?: LlmProvider;
  loadProfile?: (admin: SupabaseClient, userId: string) => Promise<EditableProfile>;
  now?: () => number;
};

export type RunPreparationOptions = {
  deadlineMs?: number;
  concurrency?: number;
  deps?: PrepareDeps;
};

type LeadRow = {
  id: string;
  company_id: string;
  status: string;
  prep_status: string | null;
  prep_started_at: string | null;
  establishment_city?: string | null;
  created_at?: string;
};

type CompanyRow = {
  id: string;
  siren: string;
  name: string;
  naf_label: string | null;
  headcount_range: string | null;
  city: string | null;
  website: string | null;
  domain: string | null;
  leaders: unknown;
  enriched_at: string | null;
};

const COMPANY_COLUMNS =
  "id, siren, name, naf_label, headcount_range, city, website, domain, leaders, enriched_at";
const LEAD_COLUMNS =
  "id, company_id, status, prep_status, prep_started_at, establishment_city, created_at";

function parseLeaders(value: unknown): CompanyFacts["leaders"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l) => {
    const o = l as Record<string, unknown>;
    return typeof o?.first_name === "string" && typeof o?.last_name === "string"
      ? [
          {
            first_name: o.first_name,
            last_name: o.last_name,
            role: typeof o.role === "string" ? o.role : "",
          },
        ]
      : [];
  });
}

export function companyFacts(row: CompanyRow, establishmentCity?: string | null): CompanyFacts {
  const website = row.website && /^https:\/\//i.test(row.website) ? row.website : null;
  return {
    id: row.id,
    siren: row.siren,
    name: row.name,
    naf_label: row.naf_label,
    city: establishmentCity ?? row.city,
    headcount_label: headcountLabel(row.headcount_range),
    headcount_min: headcountMin(row.headcount_range),
    website,
    domain:
      (row.domain && registrableDomain(row.domain)) ||
      (website && registrableDomain(website)) ||
      null,
    leaders: parseLeaders(row.leaders),
  };
}

function isProfileUsable(p: EditableProfile): boolean {
  return (
    !!p.full_name?.trim() &&
    (!!p.degree?.trim() || p.education.length > 0 || p.experiences.length > 0)
  );
}

export async function runPreparation(
  admin: SupabaseClient,
  userId: string,
  opts: RunPreparationOptions = {},
): Promise<{ done: number; failed: number; remaining: number }> {
  const deps = opts.deps ?? {};
  const now = deps.now ?? Date.now;
  const deadline = now() + (opts.deadlineMs ?? DEFAULT_PREP_DEADLINE_MS);
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? DEFAULT_PREP_CONCURRENCY));
  let done = 0;
  let failed = 0;

  const countRemaining = async (): Promise<number> => {
    try {
      const { data, error } = await admin
        .from("leads")
        .select("id")
        .eq("user_id", userId)
        .in("prep_status", ["queued", "running"]);
      if (error) return 0;
      return data?.length ?? 0;
    } catch {
      return 0;
    }
  };

  try {
    const onUsage = (usage: LlmUsageEvent) =>
      logEvent(admin, userId, "llm_usage", {
        prompt: usage.promptName,
        prompt_version: usage.promptVersion,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        attempts: usage.attempts,
        success: usage.success,
      });

    let profile: EditableProfile;
    try {
      profile = deps.loadProfile
        ? await deps.loadProfile(admin, userId)
        : (await loadEditableProfile(admin, userId)).profile;
    } catch {
      console.error("[prepare] profile load failed");
      return { done, failed, remaining: await countRemaining() };
    }
    const webSearch = deps.webSearch === undefined ? getWebSearchClient() : deps.webSearch;
    const attempted = new Set<string>();

    const claimNext = async (): Promise<LeadRow | null> => {
      const { data, error } = await admin
        .from("leads")
        .select(LEAD_COLUMNS)
        .eq("user_id", userId)
        .in("prep_status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw dbError("leads queue select", error);
      const staleBefore = now() - PREP_STALE_MS;
      for (const row of (data ?? []) as LeadRow[]) {
        if (attempted.has(row.id)) continue;
        const isStale =
          row.prep_status === "running" &&
          row.prep_started_at !== null &&
          Date.parse(row.prep_started_at) < staleBefore;
        if (row.prep_status !== "queued" && !isStale) continue;
        attempted.add(row.id);
        let claim = admin
          .from("leads")
          .update({
            prep_status: "running",
            prep_started_at: new Date(now()).toISOString(),
            prep_error: null,
          })
          .eq("id", row.id)
          .eq("user_id", userId)
          .eq("prep_status", row.prep_status as string);
        if (isStale) claim = claim.eq("prep_started_at", row.prep_started_at as string);
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) throw dbError("lead claim", claimError);
        if ((claimed ?? []).length === 1) return row;
      }
      return null;
    };

    const processLead = async (lead: LeadRow): Promise<boolean> => {
      const started = now();
      let step = "start";
      try {
        if (!isProfileUsable(profile)) throw new PrepareError("profile_incomplete");
        if (lead.status !== "selected" && lead.status !== "drafted") {
          throw new PrepareError("lead_unavailable");
        }

        step = "existing";
        const { data: existing, error: exErr } = await admin
          .from("applications")
          .select("id")
          .eq("user_id", userId)
          .eq("lead_id", lead.id)
          .maybeSingle();
        if (exErr) throw dbError("applications select", exErr);
        if (existing) {
          await markDone(lead.id);
          return true;
        }

        step = "company";
        const { data: companyRow, error: cErr } = await admin
          .from("companies")
          .select(COMPANY_COLUMNS)
          .eq("id", lead.company_id)
          .maybeSingle();
        if (cErr) throw dbError("companies select", cErr);
        if (!companyRow) throw new PrepareError("company_missing");
        const row = companyRow as CompanyRow;
        const facts = companyFacts(row, lead.establishment_city ?? null);

        // 1. Website / domain (searched once per company, shared cache).
        step = "website";
        let websiteFound = !!facts.website;
        if (!facts.website && !row.enriched_at && webSearch) {
          const results = await webSearch.search(
            `${facts.name}${facts.city ? ` ${facts.city}` : ""} site officiel`,
            { maxResults: 5 },
          );
          if (results.length > 0) {
            const picked = pickOfficialWebsite(results, facts.name);
            const { error: wErr } = await admin
              .from("companies")
              .update({
                website: picked?.website ?? null,
                domain: picked?.domain ?? null,
                enriched_at: new Date(now()).toISOString(),
              })
              .eq("id", row.id);
            if (wErr)
              console.warn(`[prepare] company enrichment save failed (${wErr.code ?? "unknown"})`);
            if (picked) {
              facts.website = picked.website;
              facts.domain = picked.domain;
              websiteFound = true;
            }
          }
        }

        // 2. Contacts.
        step = "contacts";
        const candidates = await findContacts(facts, {
          findEmailsOnWebsite: deps.findEmailsOnWebsite,
          hasMxRecord: deps.hasMxRecord,
        });
        const best = await saveContacts(lead.id, candidates);

        // 3. Hook.
        step = "insight";
        const insight = await findCompanyInsight(facts, {
          webSearch,
          provider: deps.provider,
          onUsage,
        });

        // 4. Mail.
        step = "compose";
        const mail = await composeApplication(
          { profile, company: facts, contact: best?.candidate ?? null, insight },
          { provider: deps.provider, onUsage },
        );

        step = "save";
        const { error: insErr } = await admin.from("applications").insert({
          user_id: userId,
          lead_id: lead.id,
          contact_id: best?.id ?? null,
          subject: mail.subject,
          body: mail.body,
          company_insight: insight.text,
          company_insight_source: insight.source_url,
          claims_used: mail.claims_used,
          claims_unverified: mail.claims_unverified,
          quality_warnings: mail.warnings,
          prompt_version: mail.prompt_version,
          status: "draft",
          edited_by_user: false,
        });
        if (insErr && insErr.code !== "23505") throw dbError("applications insert", insErr);

        await markDone(lead.id);
        await logEvent(admin, userId, "application_drafted", {
          duration_ms: now() - started,
          website_found: websiteFound,
          contacts_count: candidates.length,
          contact_source: best?.candidate.source ?? null,
          contact_confidence: best?.candidate.confidence ?? null,
          insight_kind: insight.kind,
          claims_unverified_count: mail.claims_unverified.length,
          warnings_count: mail.warnings.length,
          prompt_version: mail.prompt_version,
        });
        return true;
      } catch (e) {
        const err = toPrepareError(e);
        const { error: fErr } = await admin
          .from("leads")
          .update({ prep_status: "failed", prep_error: err.userMessage })
          .eq("id", lead.id)
          .eq("user_id", userId);
        if (fErr) console.error(`[prepare] lead failure save failed (${fErr.code ?? "unknown"})`);
        await logEvent(admin, userId, "preparation_failed", {
          code: err.code,
          step,
          duration_ms: now() - started,
        });
        return false;
      }
    };

    const markDone = async (leadId: string) => {
      const { error } = await admin
        .from("leads")
        .update({ status: "drafted", prep_status: "done", prep_error: null })
        .eq("id", leadId)
        .eq("user_id", userId);
      if (error) throw dbError("lead done", error);
    };

    /** Inserts new candidates (existing rows of a crashed run are reused); returns the best one. */
    const saveContacts = async (
      leadId: string,
      candidates: ContactCandidate[],
    ): Promise<{ id: string; candidate: ContactCandidate } | null> => {
      const { data: existingRows, error } = await admin
        .from("contacts")
        .select("id, email, first_name, last_name, role, source, confidence")
        .eq("user_id", userId)
        .eq("lead_id", leadId);
      if (error) throw dbError("contacts select", error);
      const stored = (existingRows ?? []) as (ContactCandidate & { id: string })[];
      const known = new Set(stored.map((c) => c.email.toLowerCase()));
      const fresh = candidates.filter((c) => !known.has(c.email.toLowerCase()));
      if (fresh.length > 0) {
        const { data: inserted, error: insErr } = await admin
          .from("contacts")
          .insert(fresh.map((c) => ({ ...c, user_id: userId, lead_id: leadId })))
          .select("id, email, first_name, last_name, role, source, confidence");
        if (insErr) throw dbError("contacts insert", insErr);
        stored.push(...((inserted ?? []) as (ContactCandidate & { id: string })[]));
      }
      const manual = stored.find((c) => c.source === "user_input");
      if (manual) return { id: manual.id, candidate: manual };
      const top = candidates[0];
      if (!top) return null;
      const row = stored.find((c) => c.email.toLowerCase() === top.email.toLowerCase());
      return row ? { id: row.id, candidate: top } : null;
    };

    const worker = async () => {
      while (now() < deadline) {
        const lead = await claimNext();
        if (!lead) return;
        if (await processLead(lead)) done++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } catch (e) {
    console.error(
      `[prepare] run failed (${e instanceof PrepareError ? e.code : e instanceof Error ? e.name : "unknown"})`,
    );
  }
  return { done, failed, remaining: await countRemaining() };
}

// ---------------------------------------------------------------------------
// regenerateApplication

type ApplicationRow = {
  id: string;
  lead_id: string;
  contact_id: string | null;
  status: string;
  scheduled_for: string | null;
  send_claimed_at: string | null;
  company_insight: string | null;
  company_insight_source: string | null;
};

/**
 * Recomposes a draft (or a validated mail not yet queued) with its current
 * contact and stored hook (no new web search). Result: status draft,
 * approved_at null, edited_by_user false. Throws PrepareError.
 */
export async function regenerateApplication(
  admin: SupabaseClient,
  userId: string,
  applicationId: string,
  deps: Pick<PrepareDeps, "provider" | "loadProfile"> = {},
): Promise<void> {
  if (!z.uuid().safeParse(applicationId).success) throw new PrepareError("not_found");
  const { data: app, error } = await admin
    .from("applications")
    .select(
      "id, lead_id, contact_id, status, scheduled_for, send_claimed_at, company_insight, company_insight_source",
    )
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("application select", error);
  if (!app) throw new PrepareError("not_found");
  const a = app as ApplicationRow;
  if (
    !(a.status === "draft" || a.status === "approved") ||
    a.scheduled_for !== null ||
    a.send_claimed_at !== null
  ) {
    throw new PrepareError("not_editable");
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: regenCount, error: regenErr } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("name", "application_regenerated")
    .gte("created_at", since);
  if (regenErr) throw dbError("events count", regenErr);
  if ((regenCount ?? 0) >= REGEN_LIMIT_PER_24H) throw new PrepareError("regen_limit");

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, company_id, establishment_city")
    .eq("id", a.lead_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (leadErr) throw dbError("lead select", leadErr);
  if (!lead) throw new PrepareError("not_found");
  const l = lead as { company_id: string; establishment_city?: string | null };

  const { data: companyRow, error: cErr } = await admin
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("id", l.company_id)
    .maybeSingle();
  if (cErr) throw dbError("companies select", cErr);
  if (!companyRow) throw new PrepareError("company_missing");
  const facts = companyFacts(companyRow as CompanyRow, l.establishment_city ?? null);

  let contact: ContactCandidate | null = null;
  if (a.contact_id) {
    const { data: c, error: ctErr } = await admin
      .from("contacts")
      .select("id, email, first_name, last_name, role, source, confidence")
      .eq("id", a.contact_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (ctErr) throw dbError("contact select", ctErr);
    contact = (c as ContactCandidate | null) ?? null;
  }

  const profile = deps.loadProfile
    ? await deps.loadProfile(admin, userId)
    : (await loadEditableProfile(admin, userId)).profile;
  if (!isProfileUsable(profile)) throw new PrepareError("profile_incomplete");

  const insight: CompanyInsight =
    a.company_insight && a.company_insight_source
      ? { text: a.company_insight, source_url: a.company_insight_source, kind: "news" }
      : a.company_insight
        ? { text: a.company_insight, source_url: null, kind: "activity" }
        : { text: `${facts.name}.`, source_url: null, kind: "activity" };

  const onUsage = (usage: LlmUsageEvent) =>
    logEvent(admin, userId, "llm_usage", {
      prompt: usage.promptName,
      prompt_version: usage.promptVersion,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      attempts: usage.attempts,
      success: usage.success,
    });

  let mail;
  try {
    mail = await composeApplication(
      { profile, company: facts, contact, insight },
      { provider: deps.provider, onUsage },
    );
  } catch (e) {
    throw toPrepareError(e);
  }

  const { data: updated, error: upErr } = await admin
    .from("applications")
    .update({
      subject: mail.subject,
      body: mail.body,
      claims_used: mail.claims_used,
      claims_unverified: mail.claims_unverified,
      quality_warnings: mail.warnings,
      prompt_version: mail.prompt_version,
      status: "draft",
      approved_at: null,
      edited_by_user: false,
      send_error: null,
    })
    .eq("id", a.id)
    .eq("user_id", userId)
    .eq("status", a.status)
    .is("scheduled_for", null)
    .is("send_claimed_at", null)
    .select("id");
  if (upErr) throw dbError("application update", upErr);
  if ((updated ?? []).length === 0) throw new PrepareError("not_editable");
  await logEvent(admin, userId, "application_regenerated", {
    claims_unverified_count: mail.claims_unverified.length,
    warnings_count: mail.warnings.length,
    prompt_version: mail.prompt_version,
  });
}
