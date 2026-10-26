import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/connection", () => ({
  getGmailStatus: vi.fn(async () => ({
    state: "active",
    email: "moi@gmail.com",
    missingScopes: false,
  })),
}));

import {
  BOUNCED_REVISE_ERROR,
  columnForStatus,
  computeStats,
  gmailThreadUrl,
  loadTrackerState,
  moveCard,
  reviseBounced,
  TrackerError,
} from "@/lib/tracker/board";
import type { TrackerCard } from "@/lib/tracker/types";

import { createFakeSupabase } from "./helpers/fake-supabase";

const ME = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

function app(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: ME,
    lead_id: "lead-1",
    contact_id: "contact-1",
    subject: "Candidature spontanée",
    body: "Bonjour,\n\nTexte du mail.",
    status: "sent",
    sent_at: "2026-10-20T10:00:00.000Z",
    last_reply_at: null,
    gmail_thread_id: "thread/1",
    followup_status: null,
    followup_subject: null,
    followup_body: null,
    followup_approved_at: null,
    followup_sent_at: null,
    followup_error: null,
    status_set_manually: false,
    ...extra,
  };
}

function seed() {
  return {
    companies: [{ id: "co-1", name: "Atelier Dupont", city: "Lyon" }],
    leads: [
      { id: "lead-1", user_id: ME, company_id: "co-1", establishment_city: null, status: "sent" },
      { id: "lead-x", user_id: OTHER, company_id: "co-1", status: "sent" },
    ],
    contacts: [
      { id: "contact-1", user_id: ME, first_name: "Marie", last_name: "Curie", email: "m@a.fr" },
    ],
    applications: [
      app("a-sent"),
      app("a-replied", { status: "replied", sent_at: "2026-10-22T10:00:00.000Z" }),
      app("a-interview", { status: "interview", sent_at: "2026-10-21T10:00:00.000Z" }),
      app("a-bounced", { status: "bounced", sent_at: "2026-10-19T10:00:00.000Z" }),
      app("a-auto", {
        sent_at: "2026-10-18T10:00:00.000Z",
        followup_status: "draft",
        followup_subject: "Re: Candidature",
        followup_body: "Relance",
      }),
      app("a-draft", { status: "draft", sent_at: null }),
      app("a-other", { user_id: OTHER, lead_id: "lead-x" }),
    ],
    replies: [
      {
        id: "r1",
        user_id: ME,
        application_id: "a-replied",
        received_at: "2026-10-23T08:00:00.000Z",
        from_email: "rh@a.fr",
        snippet: "Merci, pouvez-vous…",
        classification: "info_request",
        suggested_action: "Envoie ton relevé de notes.",
      },
      {
        id: "r0",
        user_id: ME,
        application_id: "a-replied",
        received_at: "2026-10-22T18:00:00.000Z",
        from_email: "rh@a.fr",
        snippet: "Absent",
        classification: "auto_reply",
        suggested_action: null,
      },
      {
        id: "r2",
        user_id: ME,
        application_id: "a-interview",
        received_at: "2026-10-22T08:00:00.000Z",
        from_email: "rh@a.fr",
        snippet: "Disponible jeudi ?",
        classification: "interview",
        suggested_action: "Réponds avec tes créneaux.",
      },
      {
        id: "r3",
        user_id: ME,
        application_id: "a-bounced",
        received_at: "2026-10-19T10:01:00.000Z",
        from_email: "mailer-daemon@googlemail.com",
        snippet: "Address not found",
        classification: "bounce",
        suggested_action: null,
      },
      {
        id: "r4",
        user_id: ME,
        application_id: "a-auto",
        received_at: "2026-10-18T10:05:00.000Z",
        from_email: "x@a.fr",
        snippet: "Je suis absent",
        classification: "auto_reply",
        suggested_action: null,
      },
    ],
  };
}

describe("pure helpers", () => {
  it("maps statuses to columns (bounced stays in Envoyé)", () => {
    expect(columnForStatus("sent")).toBe("sent");
    expect(columnForStatus("bounced")).toBe("sent");
    expect(columnForStatus("replied")).toBe("replied");
    expect(columnForStatus("interview")).toBe("interview");
    expect(columnForStatus("rejected")).toBe("rejected");
    expect(columnForStatus("no_reply")).toBe("no_reply");
  });

  it("builds an encoded Gmail thread link", () => {
    expect(gmailThreadUrl("18c2f/a b")).toBe("https://mail.google.com/mail/u/0/#all/18c2f%2Fa%20b");
  });

  it("computes stats with 0 sent", () => {
    expect(computeStats([])).toEqual({
      sent: 0,
      replied: 0,
      replyRate: 0,
      interviews: 0,
      pendingFollowups: 0,
    });
  });
});

describe("loadTrackerState", () => {
  it("returns only the user's sent applications, newest sent first, with joins", async () => {
    const fake = createFakeSupabase(seed(), {
      rpc: () => [{ status: "active", last_sync_at: "2026-10-26T09:00:00.000Z" }],
    });
    const state = await loadTrackerState(fake.client, ME);
    expect(state.cards.map((c) => c.applicationId)).toEqual([
      "a-replied",
      "a-interview",
      "a-sent",
      "a-bounced",
      "a-auto",
    ]);
    const replied = state.cards[0] as TrackerCard;
    expect(replied.company).toEqual({ name: "Atelier Dupont", city: "Lyon" });
    expect(replied.contact).toEqual({ name: "Marie Curie", email: "m@a.fr" });
    expect(replied.replies.map((r) => r.id)).toEqual(["r1", "r0"]);
    expect(replied.last_reply_at).toBe("2026-10-23T08:00:00.000Z");
    expect(replied.gmailUrl).toBe("https://mail.google.com/mail/u/0/#all/thread%2F1");
    const bounced = state.cards.find((c) => c.applicationId === "a-bounced");
    expect(bounced?.column).toBe("sent");
    const auto = state.cards.find((c) => c.applicationId === "a-auto");
    expect(auto?.followup).toMatchObject({ status: "draft", subject: "Re: Candidature" });
    expect(state.lastSyncAt).toBe("2026-10-26T09:00:00.000Z");
    expect(state.gmail.state).toBe("active");
  });

  it("counts only human replies in the reply rate", async () => {
    const fake = createFakeSupabase(seed(), { rpc: () => [] });
    const { stats } = await loadTrackerState(fake.client, ME);
    // a-replied (info_request) and a-interview (interview); auto-reply and bounce excluded.
    expect(stats).toEqual({
      sent: 5,
      replied: 2,
      replyRate: 0.4,
      interviews: 1,
      pendingFollowups: 1,
    });
  });

  it("returns lastSyncAt null when the status RPC fails", async () => {
    const fake = createFakeSupabase(seed());
    const state = await loadTrackerState(fake.client, ME);
    expect(state.lastSyncAt).toBeNull();
  });

  it("throws a TrackerError on a database error", async () => {
    const fake = createFakeSupabase(seed(), {
      failOn: (t) => (t === "replies" ? { code: "500", message: "boom" } : null),
    });
    await expect(loadTrackerState(fake.client, ME)).rejects.toBeInstanceOf(TrackerError);
  });

  it("handles more applications than one in() chunk", async () => {
    const data = seed();
    data.applications = Array.from({ length: 250 }, (_, i) =>
      app(`a-${String(i).padStart(3, "0")}`, {
        sent_at: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
      }),
    );
    data.replies = [{ ...data.replies[0], application_id: "a-001" }];
    const fake = createFakeSupabase(data, { rpc: () => [] });
    const state = await loadTrackerState(fake.client, ME);
    expect(state.cards).toHaveLength(250);
    expect(state.cards[0].applicationId).toBe("a-249");
    expect(state.cards.find((c) => c.applicationId === "a-001")?.replies).toHaveLength(1);
    expect(fake.calls.filter((c) => c.table === "replies")).toHaveLength(3);
  });
});

describe("moveCard", () => {
  let fake: ReturnType<typeof createFakeSupabase>;
  beforeEach(() => {
    fake = createFakeSupabase(seed());
  });

  it("moves a sent card, marks it manual and logs an event", async () => {
    const res = await moveCard(fake.client, ME, "a-sent", "interview");
    expect(res).toEqual({ changed: true, status: "interview" });
    const row = fake.table("applications").find((a) => a.id === "a-sent");
    expect(row).toMatchObject({ status: "interview", status_set_manually: true });
    expect(fake.table("events")).toEqual([
      expect.objectContaining({
        user_id: ME,
        name: "card_moved",
        props: { from: "sent", to: "interview" },
      }),
    ]);
  });

  it("dismisses a pending follow-up draft when the card leaves Envoyé", async () => {
    const row = fake.table("applications").find((a) => a.id === "a-sent")!;
    row.followup_status = "draft";
    await moveCard(fake.client, ME, "a-sent", "rejected");
    expect(row.followup_status).toBe("dismissed");
  });

  it("lets a bounced card move back to Envoyé", async () => {
    await moveCard(fake.client, ME, "a-bounced", "sent");
    expect(fake.table("applications").find((a) => a.id === "a-bounced")?.status).toBe("sent");
  });

  it("is a no-op on the current column", async () => {
    expect(await moveCard(fake.client, ME, "a-sent", "sent")).toEqual({
      changed: false,
      status: "sent",
    });
    expect(fake.table("events")).toHaveLength(0);
  });

  it("refuses another user's card, drafts and unknown columns", async () => {
    await expect(moveCard(fake.client, ME, "a-other", "rejected")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(moveCard(fake.client, ME, "a-draft", "rejected")).rejects.toMatchObject({
      code: "not_allowed",
    });
    await expect(moveCard(fake.client, ME, "a-sent", "draft" as never)).rejects.toMatchObject({
      code: "not_allowed",
    });
    expect(fake.table("applications").find((a) => a.id === "a-other")?.status).toBe("sent");
    expect(fake.table("applications").find((a) => a.id === "a-draft")?.status).toBe("draft");
  });
});

describe("reviseBounced", () => {
  it("puts a bounced mail back to draft without recipient and keeps the replies", async () => {
    const fake = createFakeSupabase(seed());
    await reviseBounced(fake.client, ME, "a-bounced");
    const row = fake.table("applications").find((a) => a.id === "a-bounced");
    expect(row).toMatchObject({
      status: "draft",
      contact_id: null,
      sent_at: null,
      gmail_thread_id: null,
      gmail_message_id: null,
      approved_at: null,
      scheduled_for: null,
      send_claimed_at: null,
      next_followup_at: null,
      followup_status: null,
      followup_count: 0,
      last_reply_at: null,
      interview_notified_at: null,
      send_error: BOUNCED_REVISE_ERROR,
    });
    expect(fake.table("leads").find((l) => l.id === "lead-1")?.status).toBe("drafted");
    expect(fake.table("replies").some((r) => r.application_id === "a-bounced")).toBe(true);
    // The address that bounced is never offered again.
    expect(fake.table("contacts").some((c) => c.id === "contact-1")).toBe(false);
  });

  it("only applies to the user's bounced mails", async () => {
    const fake = createFakeSupabase(seed());
    await expect(reviseBounced(fake.client, ME, "a-sent")).rejects.toMatchObject({
      code: "not_allowed",
    });
    await expect(reviseBounced(fake.client, OTHER, "a-bounced")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(fake.table("applications").find((a) => a.id === "a-bounced")?.status).toBe("bounced");
    expect(fake.table("leads").find((l) => l.id === "lead-1")?.status).toBe("sent");
  });
});
