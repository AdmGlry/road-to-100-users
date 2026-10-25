import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREP_STALE_MS } from "@/lib/hunter/application-types";
import {
  PrepareError,
  queuePreparation,
  regenerateApplication,
  runPreparation,
} from "@/lib/hunter/prepare";
import type { WebResult, WebSearchClient } from "@/lib/integrations/websearch";
import type { LlmProvider } from "@/lib/llm/client";

import { goodMail, PROFILE } from "./fixtures/enrich";
import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const COMPANY_A = "c0c0c0c0-0000-4000-8000-00000000000a";
const COMPANY_B = "c0c0c0c0-0000-4000-8000-00000000000b";
const lead = (n: number) => `1e1e1e1e-0000-4000-8000-00000000000${n}`;
const T0 = Date.parse("2026-10-25T10:00:00Z");

type Row = Record<string, unknown>;

/** The shared fake has no `.is()`: emulate it (null ⇔ missing) for these tests. */
function withIs(client: SupabaseClient): SupabaseClient {
  const proto = Object.getPrototypeOf((client as unknown as { from(t: string): object }).from("x"));
  if (!proto.is) {
    proto.is = function (this: { filters: ((r: Row) => boolean)[] }, col: string, v: unknown) {
      this.filters.push((r) => (r[col] ?? null) === v);
      return this;
    };
  }
  return client;
}

function setup(opts: { profile?: Row | null; leads?: Row[]; companies?: Row[] } = {}) {
  const shared: Record<string, Row[]> = {};
  const user = createFakeSupabase(
    {
      profiles: opts.profile === null ? [] : [{ user_id: USER, ...PROFILE, ...(opts.profile ?? {}) }],
      companies: opts.companies ?? [
        {
          id: COMPANY_A,
          siren: "901234567",
          name: "ACME CONSEIL",
          naf_label: "Conseil en systèmes et logiciels informatiques",
          headcount_range: "12",
          city: "Nantes",
          website: null,
          domain: null,
          enriched_at: null,
          leaders: [{ first_name: "Jean", last_name: "Le Gall", role: "Président" }],
        },
        {
          id: COMPANY_B,
          siren: "902345678",
          name: "BETA DATA",
          naf_label: "Traitement de données",
          headcount_range: "32",
          city: "Rezé",
          website: "https://www.betadata.fr",
          domain: "betadata.fr",
          enriched_at: "2026-10-01T00:00:00Z",
          leaders: [],
        },
      ],
      leads: opts.leads ?? [
        { id: lead(1), user_id: USER, company_id: COMPANY_A, status: "selected", prep_status: null, prep_started_at: null, created_at: "2026-10-25T09:00:00Z" },
        { id: lead(2), user_id: USER, company_id: COMPANY_B, status: "selected", prep_status: null, prep_started_at: null, created_at: "2026-10-25T09:00:01Z" },
        { id: lead(3), user_id: USER, company_id: COMPANY_B, status: "suggested", prep_status: null, prep_started_at: null, created_at: "2026-10-25T09:00:02Z" },
        { id: lead(4), user_id: OTHER, company_id: COMPANY_A, status: "selected", prep_status: null, prep_started_at: null, created_at: "2026-10-25T09:00:03Z" },
      ],
      applications: [],
      contacts: [],
      events: [],
    },
    { tables: shared },
  );
  const admin = createFakeSupabase({}, { tables: shared });
  return { user: withIs(user.client), admin: withIs(admin.client), shared, calls: admin.calls };
}

function llm(opts: { composeFails?: boolean; insight?: unknown } = {}) {
  const calls = { compose: 0, insight: 0 };
  const prompts: string[] = [];
  const provider: LlmProvider = {
    async complete(req) {
      prompts.push(`${req.system}\n${req.messages.map((m) => m.content).join("\n")}`);
      if (req.system?.includes("accroche factuelle")) {
        calls.insight++;
        return { text: JSON.stringify(opts.insight ?? { insight: null, source_url: null }), inputTokens: 50, outputTokens: 10 };
      }
      calls.compose++;
      await new Promise((r) => setTimeout(r, 1));
      if (opts.composeFails) return { text: "pas du json", inputTokens: 10, outputTokens: 5 };
      return { text: JSON.stringify(goodMail()), inputTokens: 800, outputTokens: 300 };
    },
  };
  return { provider, calls, prompts };
}

const noNet = {
  webSearch: null,
  findEmailsOnWebsite: vi.fn(async () => []),
  hasMxRecord: vi.fn(async () => true),
  now: () => T0,
};

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("LLM_API_KEY", "k");
  vi.stubEnv("LLM_MODEL_FAST", "fast");
  vi.stubEnv("LLM_MODEL_SMART", "smart");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const leadRow = (shared: Record<string, Row[]>, id: string) => shared.leads.find((l) => l.id === id)!;

describe("queuePreparation", () => {
  it("queues only the student's own selected leads without an application", async () => {
    const { user, shared } = setup();
    shared.applications.push({ id: "a0", user_id: USER, lead_id: lead(2) });
    const res = await queuePreparation(user, USER, [lead(1), lead(2), lead(3), lead(4), lead(1)]);
    expect(res).toEqual({ queued: 1 });
    expect(leadRow(shared, lead(1)).prep_status).toBe("queued");
    expect(leadRow(shared, lead(2)).prep_status).toBeNull();
    expect(leadRow(shared, lead(3)).prep_status).toBeNull();
    expect(leadRow(shared, lead(4)).prep_status).toBeNull();
  });

  it("rejects invalid ids and does not re-queue running leads", async () => {
    const { user, shared } = setup();
    await expect(queuePreparation(user, USER, ["nope"])).rejects.toBeInstanceOf(PrepareError);
    leadRow(shared, lead(1)).prep_status = "running";
    expect(await queuePreparation(user, USER, [lead(1)])).toEqual({ queued: 0 });
  });
});

describe("runPreparation", () => {
  it("works without web search: no website → no contact, activity hook, draft saved", async () => {
    const { user, admin, shared } = setup();
    await queuePreparation(user, USER, [lead(1)]);
    const { provider, calls } = llm();
    const res = await runPreparation(admin, USER, { deps: { ...noNet, provider } });
    expect(res).toEqual({ done: 1, failed: 0, remaining: 0 });
    expect(calls).toEqual({ compose: 1, insight: 0 });
    expect(shared.contacts).toHaveLength(0);
    expect(shared.applications).toHaveLength(1);
    expect(shared.applications[0]).toMatchObject({
      user_id: USER,
      lead_id: lead(1),
      contact_id: null,
      status: "draft",
      company_insight_source: null,
      claims_unverified: [],
      prompt_version: "compose_application@1",
    });
    expect(String(shared.applications[0].company_insight)).toContain("ACME CONSEIL exerce");
    expect(leadRow(shared, lead(1))).toMatchObject({ status: "drafted", prep_status: "done" });
    expect(noNet.findEmailsOnWebsite).not.toHaveBeenCalled();
    // Events: usage + drafted, never mail content or addresses.
    const names = shared.events.map((e) => e.name);
    expect(names).toContain("llm_usage");
    expect(names).toContain("application_drafted");
    const props = JSON.stringify(shared.events.map((e) => e.props));
    expect(props).not.toContain("Bonjour");
    expect(props).not.toContain("@");
  });

  it("finds the website, saves it to companies, stores contacts and a sourced hook", async () => {
    const { user, admin, shared } = setup();
    await queuePreparation(user, USER, [lead(1)]);
    const results: WebResult[] = [
      { title: "ACME Conseil – conseil IT à Nantes", url: "https://www.acme-conseil.fr/", snippet: "" },
      {
        title: "ACME Conseil ouvre une agence à Rennes",
        url: "https://www.ouest-france.fr/acme",
        snippet: "Le cabinet ACME Conseil ouvre une nouvelle agence à Rennes.",
      },
    ];
    const queries: string[] = [];
    const webSearch: WebSearchClient = {
      async search(q) {
        queries.push(q);
        return results;
      },
    };
    const { provider } = llm({
      insight: { insight: "ACME Conseil ouvre une nouvelle agence à Rennes.", source_url: "https://www.ouest-france.fr/acme" },
    });
    const findEmailsOnWebsite = vi.fn(async () => [{ email: "recrutement@acme-conseil.fr", page: "https://www.acme-conseil.fr/contact" }]);
    const res = await runPreparation(admin, USER, {
      deps: { ...noNet, webSearch, findEmailsOnWebsite, provider },
    });
    expect(res.done).toBe(1);
    expect(queries[0]).toBe("ACME CONSEIL Nantes site officiel");
    expect(shared.companies.find((c) => c.id === COMPANY_A)).toMatchObject({
      website: "https://www.acme-conseil.fr",
      domain: "acme-conseil.fr",
    });
    expect(findEmailsOnWebsite).toHaveBeenCalledWith("acme-conseil.fr");
    expect(shared.contacts.length).toBeGreaterThan(1);
    expect(shared.contacts.every((c) => c.user_id === USER && c.lead_id === lead(1))).toBe(true);
    const best = shared.contacts.find((c) => c.id === shared.applications[0].contact_id);
    expect(best).toMatchObject({ email: "recrutement@acme-conseil.fr", source: "website", confidence: "high" });
    expect(shared.applications[0]).toMatchObject({
      company_insight: "ACME Conseil ouvre une nouvelle agence à Rennes.",
      company_insight_source: "https://www.ouest-france.fr/acme",
    });
  });

  it("is safe to run concurrently: each lead prepared exactly once", async () => {
    const { user, admin, shared } = setup();
    await queuePreparation(user, USER, [lead(1), lead(2)]);
    const { provider, calls } = llm();
    const deps = { ...noNet, provider };
    const [a, b] = await Promise.all([
      runPreparation(admin, USER, { deps, concurrency: 2 }),
      runPreparation(admin, USER, { deps, concurrency: 2 }),
    ]);
    expect(a.done + b.done).toBe(2);
    expect(calls.compose).toBe(2);
    expect(shared.applications).toHaveLength(2);
    expect(new Set(shared.applications.map((x) => x.lead_id)).size).toBe(2);
  });

  it("never throws: an LLM failure marks the lead failed with a French message", async () => {
    const { user, admin, shared } = setup();
    await queuePreparation(user, USER, [lead(1)]);
    const { provider } = llm({ composeFails: true });
    const res = await runPreparation(admin, USER, { deps: { ...noNet, provider } });
    expect(res).toEqual({ done: 0, failed: 1, remaining: 0 });
    expect(leadRow(shared, lead(1))).toMatchObject({ prep_status: "failed" });
    expect(String(leadRow(shared, lead(1)).prep_error)).toMatch(/IA/);
    expect(shared.applications).toHaveLength(0);
    expect(shared.events.find((e) => e.name === "preparation_failed")?.props).toMatchObject({
      code: "llm_failed",
      step: "compose",
    });
  });

  it("fails clearly when the profile is incomplete", async () => {
    const { user, admin, shared } = setup({ profile: { full_name: null } });
    await queuePreparation(user, USER, [lead(1)]);
    const res = await runPreparation(admin, USER, { deps: { ...noNet, provider: llm().provider } });
    expect(res.failed).toBe(1);
    expect(String(leadRow(shared, lead(1)).prep_error)).toMatch(/Complète ton profil/);
  });

  it("does not start leads after the deadline", async () => {
    const { user, admin } = setup();
    await queuePreparation(user, USER, [lead(1), lead(2)]);
    const { provider, calls } = llm();
    let t = T0;
    const res = await runPreparation(admin, USER, {
      deadlineMs: 1000,
      concurrency: 1,
      deps: {
        ...noNet,
        provider,
        now: () => {
          t += 400;
          return t;
        },
      },
    });
    expect(calls.compose).toBeLessThan(2);
    expect(res.remaining).toBeGreaterThan(0);
  });

  it("resumes stale running leads but not fresh ones", async () => {
    const { admin, shared } = setup();
    Object.assign(leadRow(shared, lead(1)), {
      prep_status: "running",
      prep_started_at: new Date(T0 - PREP_STALE_MS - 1000).toISOString(),
    });
    Object.assign(leadRow(shared, lead(2)), {
      prep_status: "running",
      prep_started_at: new Date(T0 - 1000).toISOString(),
    });
    const res = await runPreparation(admin, USER, { deps: { ...noNet, provider: llm().provider } });
    expect(res).toEqual({ done: 1, failed: 0, remaining: 1 });
    expect(leadRow(shared, lead(1)).prep_status).toBe("done");
    expect(leadRow(shared, lead(2)).prep_status).toBe("running");
  });

  it("never touches another user's leads", async () => {
    const { admin, shared } = setup();
    leadRow(shared, lead(4)).prep_status = "queued";
    const res = await runPreparation(admin, USER, { deps: { ...noNet, provider: llm().provider } });
    expect(res.done).toBe(0);
    expect(leadRow(shared, lead(4)).prep_status).toBe("queued");
  });
});

describe("regenerateApplication", () => {
  const APP = "a0a0a0a0-0000-4000-8000-0000000000a1";
  function withApp(extra: Row) {
    const s = setup();
    s.shared.applications.push({
      id: APP,
      user_id: USER,
      lead_id: lead(1),
      contact_id: null,
      subject: "old",
      body: "old",
      status: "draft",
      approved_at: null,
      scheduled_for: null,
      send_claimed_at: null,
      edited_by_user: true,
      company_insight: "ACME CONSEIL exerce dans le conseil.",
      company_insight_source: null,
      ...extra,
    });
    return s;
  }

  it("recomposes a validated, unscheduled mail back to draft", async () => {
    const { admin, shared } = withApp({ status: "approved", approved_at: "2026-10-25T09:00:00Z" });
    const { provider, prompts } = llm();
    await regenerateApplication(admin, USER, APP, { provider });
    expect(shared.applications[0]).toMatchObject({
      subject: goodMail().subject,
      status: "draft",
      approved_at: null,
      edited_by_user: false,
    });
    expect(prompts[0]).toContain("Accroche vérifiée :\n<<<\naucune\n>>>");
  });

  it("refuses scheduled, sent or foreign applications", async () => {
    const scheduled = withApp({ status: "approved", scheduled_for: "2026-10-25T11:00:00Z" });
    await expect(regenerateApplication(scheduled.admin, USER, APP, { provider: llm().provider })).rejects.toMatchObject({
      code: "not_editable",
    });
    const sent = withApp({ status: "sent" });
    await expect(regenerateApplication(sent.admin, USER, APP, { provider: llm().provider })).rejects.toMatchObject({
      code: "not_editable",
    });
    const foreign = withApp({});
    await expect(regenerateApplication(foreign.admin, OTHER, APP, { provider: llm().provider })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
