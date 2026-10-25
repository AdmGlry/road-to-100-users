import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/quotas", () => ({
  getSendQuota: vi.fn(async () => ({ used: 2, limit: 20, queued: 1, remaining: 17 })),
}));
vi.mock("@/lib/google/connection", () => ({
  getGmailStatus: vi.fn(async () => ({
    state: "active",
    email: "moi@gmail.com",
    missingScopes: false,
  })),
}));

import {
  adaptGreeting,
  approveApplication,
  changeContact,
  changeContactInputSchema,
  dismissApplication,
  dismissFailedLead,
  hasDueSends,
  loadReviewState,
  mailContentSchema,
  prepareRegeneration,
  ReviewError,
  shouldResumePreparation,
  unapproveApplication,
  updateApplication,
} from "@/lib/hunter/review";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-25T12:00:00Z");
const APP = "a0a0a0a0-0000-4000-8000-000000000001";
const LEAD = "1e1e1e1e-0000-4000-8000-000000000001";
const COMPANY = "c0c0c0c0-0000-4000-8000-000000000001";
const CONTACT_LOW = "cc000000-0000-4000-8000-000000000001";
const CONTACT_MED = "cc000000-0000-4000-8000-000000000002";

function seed(appOver: Record<string, unknown> = {}) {
  return createFakeSupabase({
    companies: [
      {
        id: COMPANY,
        name: "ACME",
        city: "Rennes",
        naf_label: "Conseil",
        headcount_range: "12",
        website: "https://acme.fr",
      },
    ],
    leads: [
      {
        id: LEAD,
        user_id: USER,
        company_id: COMPANY,
        fit_score: 80,
        status: "drafted",
        establishment_city: "Nantes",
      },
    ],
    contacts: [
      {
        id: CONTACT_LOW,
        user_id: USER,
        lead_id: LEAD,
        first_name: null,
        last_name: null,
        role: null,
        email: "contact@acme.fr",
        source: "generic",
        confidence: "low",
        created_at: "2026-10-25T10:00:00Z",
      },
      {
        id: CONTACT_MED,
        user_id: USER,
        lead_id: LEAD,
        first_name: "Ana",
        last_name: "Lopez",
        role: "Gérante",
        email: "ana.lopez@acme.fr",
        source: "pattern_guess",
        confidence: "medium",
        created_at: "2026-10-25T10:00:01Z",
      },
    ],
    applications: [
      {
        id: APP,
        user_id: USER,
        lead_id: LEAD,
        contact_id: CONTACT_MED,
        subject: "Alternance – ACME",
        body: "Bonjour Ana Lopez,\n\nJe suis étudiant.",
        company_insight: "ACME ouvre un site.",
        company_insight_source: "https://news.example/acme",
        claims_unverified: ["Stage chez Google"],
        status: "draft",
        approved_at: null,
        scheduled_for: null,
        sent_at: null,
        send_error: null,
        send_claimed_at: null,
        edited_by_user: false,
        created_at: "2026-10-25T10:00:00Z",
        ...appOver,
      },
    ],
  });
}

const app = (db: ReturnType<typeof seed>) => db.table("applications").find((a) => a.id === APP)!;

beforeEach(() => vi.clearAllMocks());

describe("loadReviewState", () => {
  it("joins company and contacts, best contact first, plus quota and Gmail", async () => {
    const db = seed();
    db.table("leads").push({
      id: "1e1e1e1e-0000-4000-8000-000000000002",
      user_id: USER,
      company_id: COMPANY,
      prep_status: "running",
      prep_error: null,
      company: null,
    });
    const state = await loadReviewState(db.client, USER, { now: NOW });
    expect(state.items).toHaveLength(1);
    const item = state.items[0];
    expect(item.company).toMatchObject({ name: "ACME", city: "Nantes", activity: "Conseil" });
    expect(item.contact?.id).toBe(CONTACT_MED);
    expect(item.contacts.map((c) => c.id)).toEqual([CONTACT_MED, CONTACT_LOW]);
    expect(item.claims_unverified).toEqual(["Stage chez Google"]);
    expect(state.preparing).toEqual([
      expect.objectContaining({ prep_status: "running", companyName: "ACME" }),
    ]);
    expect(state.quota.remaining).toBe(17);
    expect(state.gmail.state).toBe("active");
  });

  it("keeps sent mails for 24 h only and never another user's rows", async () => {
    const db = seed({ status: "sent", sent_at: "2026-10-24T11:00:00Z" });
    db.table("applications").push({
      id: "a0a0a0a0-0000-4000-8000-000000000009",
      user_id: OTHER,
      lead_id: LEAD,
      status: "draft",
    });
    expect((await loadReviewState(db.client, USER, { now: NOW })).items).toHaveLength(0);
    app(db).sent_at = "2026-10-25T11:00:00Z";
    expect((await loadReviewState(db.client, USER, { now: NOW })).items).toHaveLength(1);
  });
});

describe("shouldResumePreparation", () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const old = new Date(NOW.getTime() - 10 * 60_000).toISOString();
  it("resumes queued leads without a live runner, or a stale runner", () => {
    expect(shouldResumePreparation([{ prep_status: "queued", prep_started_at: null }], NOW)).toBe(
      true,
    );
    expect(
      shouldResumePreparation(
        [
          { prep_status: "queued", prep_started_at: null },
          { prep_status: "running", prep_started_at: recent },
        ],
        NOW,
      ),
    ).toBe(false);
    expect(shouldResumePreparation([{ prep_status: "running", prep_started_at: old }], NOW)).toBe(
      true,
    );
    expect(shouldResumePreparation([], NOW)).toBe(false);
  });
});

describe("hasDueSends", () => {
  it("detects validated mails whose time has come", async () => {
    const db = seed({
      status: "approved",
      approved_at: "t",
      scheduled_for: "2026-10-25T12:30:00Z",
    });
    expect(await hasDueSends(db.client, USER, NOW)).toBe(false);
    app(db).scheduled_for = "2026-10-25T11:59:00Z";
    expect(await hasDueSends(db.client, USER, NOW)).toBe(true);
  });
});

describe("mailContentSchema", () => {
  it("removes line breaks from the subject (header injection) and trims", () => {
    const parsed = mailContentSchema.parse({ subject: " Objet\r\nBcc: x@y.z ", body: " a\r\nb " });
    expect(parsed).toEqual({ subject: "Objet Bcc: x@y.z", body: "a\nb" });
    expect(mailContentSchema.safeParse({ subject: "  ", body: "x" }).success).toBe(false);
    expect(mailContentSchema.safeParse({ subject: "x".repeat(121), body: "x" }).success).toBe(
      false,
    );
  });
});

describe("updateApplication", () => {
  it("saves an edit and marks it as edited", async () => {
    const db = seed();
    const res = await updateApplication(db.client, USER, APP, {
      subject: "Nouveau",
      body: "Texte",
    });
    expect(res).toEqual({ changed: true, status: "draft" });
    expect(app(db)).toMatchObject({ subject: "Nouveau", body: "Texte", edited_by_user: true });
  });

  it("sets an approved (even queued) mail back to draft", async () => {
    const db = seed({
      status: "approved",
      approved_at: "t",
      scheduled_for: "2026-10-25T12:30:00Z",
    });
    await updateApplication(db.client, USER, APP, { subject: "Nouveau", body: "Texte" });
    expect(app(db)).toMatchObject({ status: "draft", approved_at: null, scheduled_for: null });
  });

  it("keeps the validation when nothing changed", async () => {
    const db = seed({ status: "approved", approved_at: "t" });
    const a = app(db);
    const res = await updateApplication(db.client, USER, APP, {
      subject: String(a.subject),
      body: String(a.body),
    });
    expect(res.changed).toBe(false);
    expect(app(db).status).toBe("approved");
  });

  it("refuses a mail being sent, sent, or of another user", async () => {
    const claimed = seed({ status: "approved", approved_at: "t", send_claimed_at: "t" });
    await expect(
      updateApplication(claimed.client, USER, APP, { subject: "a", body: "b" }),
    ).rejects.toMatchObject({ code: "locked" });
    const sent = seed({ status: "sent" });
    await expect(
      updateApplication(sent.client, USER, APP, { subject: "a", body: "b" }),
    ).rejects.toMatchObject({ code: "locked" });
    await expect(
      updateApplication(seed().client, OTHER, APP, { subject: "a", body: "b" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("approve / unapprove", () => {
  it("approves a draft with a valid recipient", async () => {
    const db = seed();
    await approveApplication(db.client, USER, APP, NOW);
    expect(app(db)).toMatchObject({ status: "approved", approved_at: NOW.toISOString() });
  });

  it("requires a recipient with a valid address", async () => {
    const none = seed({ contact_id: null });
    await expect(approveApplication(none.client, USER, APP)).rejects.toMatchObject({
      code: "no_contact",
    });
    const bad = seed();
    bad.table("contacts").find((c) => c.id === CONTACT_MED)!.email = "pas-une-adresse";
    await expect(approveApplication(bad.client, USER, APP)).rejects.toMatchObject({
      code: "invalid_email",
    });
    expect(app(bad).status).toBe("draft");
  });

  it("unapproves and cancels a queued send that has not started", async () => {
    const db = seed({
      status: "approved",
      approved_at: "t",
      scheduled_for: "2026-10-25T12:30:00Z",
    });
    await unapproveApplication(db.client, USER, APP);
    expect(app(db)).toMatchObject({ status: "draft", approved_at: null, scheduled_for: null });
  });

  it("cannot unapprove a mail already claimed by the send worker", async () => {
    const db = seed({
      status: "approved",
      approved_at: "t",
      scheduled_for: "t",
      send_claimed_at: "t",
    });
    await expect(unapproveApplication(db.client, USER, APP)).rejects.toBeInstanceOf(ReviewError);
    expect(app(db).status).toBe("approved");
  });
});

describe("dismiss", () => {
  it("deletes the draft and dismisses the lead", async () => {
    const db = seed();
    await dismissApplication(db.client, USER, APP);
    expect(db.table("applications")).toHaveLength(0);
    expect(db.table("leads")[0]).toMatchObject({ status: "dismissed", prep_status: null });
  });

  it("refuses a sent mail", async () => {
    const db = seed({ status: "sent" });
    await expect(dismissApplication(db.client, USER, APP)).rejects.toMatchObject({
      code: "locked",
    });
    expect(db.table("applications")).toHaveLength(1);
  });

  it("removes a failed preparation only", async () => {
    const db = seed();
    db.table("leads")[0].prep_status = "failed";
    await dismissFailedLead(db.client, USER, LEAD);
    expect(db.table("leads")[0]).toMatchObject({ status: "dismissed", prep_status: null });
    await expect(dismissFailedLead(db.client, USER, LEAD)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("changeContact", () => {
  it("switches to another candidate and adapts the greeting", async () => {
    const db = seed({ status: "approved", approved_at: "t" });
    await changeContact(db.client, USER, APP, { contactId: CONTACT_LOW });
    expect(app(db)).toMatchObject({
      contact_id: CONTACT_LOW,
      status: "draft",
      approved_at: null,
      body: "Bonjour,\n\nJe suis étudiant.",
    });
  });

  it("adds a typed address as a reliable user_input contact", async () => {
    const db = seed();
    const input = changeContactInputSchema.parse({
      email: "  RH@Acme.fr ",
      first_name: "Léa",
      last_name: "Martin",
    });
    const res = await changeContact(db.client, USER, APP, input);
    const created = db.table("contacts").find((c) => c.id === res.contactId)!;
    expect(created).toMatchObject({
      user_id: USER,
      lead_id: LEAD,
      email: "rh@acme.fr",
      source: "user_input",
      confidence: "high",
    });
    expect(app(db).body).toBe("Bonjour Léa Martin,\n\nJe suis étudiant.");
  });

  it("reuses an existing contact with the same address", async () => {
    const db = seed();
    const input = changeContactInputSchema.parse({ email: "contact@acme.fr" });
    const res = await changeContact(db.client, USER, APP, input);
    expect(res.contactId).toBe(CONTACT_LOW);
    expect(db.table("contacts")).toHaveLength(2);
  });

  it("refuses a contact of another lead", async () => {
    const db = seed();
    db.table("contacts").push({
      id: "cc000000-0000-4000-8000-000000000009",
      user_id: USER,
      lead_id: "x",
      email: "a@b.fr",
    });
    await expect(
      changeContact(db.client, USER, APP, { contactId: "cc000000-0000-4000-8000-000000000009" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("validates typed addresses", () => {
    expect(changeContactInputSchema.safeParse({ email: "pas valide" }).success).toBe(false);
    expect(changeContactInputSchema.safeParse({ contactId: "nope" }).success).toBe(false);
  });
});

describe("adaptGreeting", () => {
  it("only rewrites a Bonjour first line", () => {
    const named = { first_name: "Léa", last_name: "Martin" };
    expect(adaptGreeting("Bonjour,\nTexte", named)).toBe("Bonjour Léa Martin,\nTexte");
    expect(
      adaptGreeting("Bonjour Monsieur Dupont,\nTexte", { first_name: null, last_name: null }),
    ).toBe("Bonjour,\nTexte");
    expect(adaptGreeting("Madame,\nTexte", named)).toBe("Madame,\nTexte");
    expect(adaptGreeting("Bonjour, je suis Léo et je cherche", named)).toBe(
      "Bonjour, je suis Léo et je cherche",
    );
  });
});

describe("prepareRegeneration", () => {
  it("sets an approved mail back to draft before regenerating", async () => {
    const db = seed({ status: "approved", approved_at: "t", scheduled_for: "t" });
    await prepareRegeneration(db.client, USER, APP);
    expect(app(db)).toMatchObject({ status: "draft", approved_at: null, scheduled_for: null });
  });
});
