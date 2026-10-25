import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GmailNotConnectedError } from "@/lib/google/connection";
import {
  processSendQueue,
  queueApprovedApplications,
  SEND_ERRORS,
  type SendDeps,
} from "@/lib/hunter/send";
import { GmailSendError } from "@/lib/integrations/gmail";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const at = (deltaMs: number) => new Date(NOW.getTime() + deltaMs).toISOString();
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

type Row = Record<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function app(overrides: Row = {}): Row {
  return {
    id: "app-1",
    user_id: USER,
    lead_id: "lead-1",
    contact_id: "contact-1",
    subject: "Alternance Business Analyst – Acme",
    body: "Bonjour,\n\nJe candidate.",
    status: "approved",
    approved_at: at(-600_000),
    scheduled_for: at(-1_000),
    send_claimed_at: null,
    send_error: null,
    ...overrides,
  };
}

function setup(applications: Row[], extra: Record<string, Row[]> = {}) {
  const db = createFakeSupabase(
    {
      applications,
      contacts: [
        { id: "contact-1", user_id: USER, email: "recrutement@acme.fr" },
        { id: "contact-2", user_id: OTHER, email: "rh@beta.fr" },
      ],
      profiles: [
        { user_id: USER, full_name: "Léa Martin", cv_storage_path: `${USER}/cv.pdf` },
        { user_id: OTHER, full_name: "Tom Durand", cv_storage_path: `${OTHER}/cv.pdf` },
      ],
      leads: [
        { id: "lead-1", user_id: USER, status: "drafted" },
        { id: "lead-2", user_id: OTHER, status: "drafted" },
      ],
      send_log: [],
      ...extra,
    },
    {
      // Same semantics as public.reserve_send_slot (20 / rolling 24 h).
      rpc: (name, args) => {
        if (name !== "reserve_send_slot") throw new Error("unexpected rpc");
        const since = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
        const used = db
          .table("send_log")
          .filter((r) => r.user_id === args!.p_user && (r.sent_at as string) > since).length;
        if (used >= (args!.p_limit as number)) return null;
        const id = crypto.randomUUID();
        db.table("send_log").push({
          id,
          user_id: args!.p_user,
          application_id: args!.p_application,
          sent_at: NOW.toISOString(),
        });
        return id;
      },
    },
  );
  const sendRawMessage = vi.fn(async () => ({ id: "msg-1", threadId: "thread-1" }));
  const deps: Partial<SendDeps> = {
    getValidAccessToken: vi.fn(async () => ({ accessToken: "ya29.token", email: "lea@gmail.com" })),
    sendRawMessage,
    downloadCv: vi.fn(async () => PDF),
    logEvent: vi.fn(async () => {}),
  };
  const run = (opts: Parameters<typeof processSendQueue>[1] = {}) =>
    processSendQueue(db.client, { now: () => NOW, deps, ...opts });
  const appRow = (id = "app-1") => db.table("applications").find((r) => r.id === id)!;
  return { db, deps, sendRawMessage, run, appRow };
}

describe("processSendQueue — send conditions", () => {
  it("sends a due approved mail with the CV and records Gmail ids", async () => {
    const { run, sendRawMessage, appRow, db, deps } = setup([app()]);
    expect(await run()).toEqual({ sent: 1, failed: 0, deferred: 0 });

    expect(sendRawMessage).toHaveBeenCalledTimes(1);
    const [token, raw] = sendRawMessage.mock.calls[0] as unknown as [string, string];
    expect(token).toBe("ya29.token");
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: recrutement@acme.fr");
    expect(mime).toContain('filename="CV_Lea_Martin.pdf"');
    expect(mime).toContain("<lea@gmail.com>");

    expect(appRow()).toMatchObject({
      status: "sent",
      sent_at: NOW.toISOString(),
      gmail_message_id: "msg-1",
      gmail_thread_id: "thread-1",
      next_followup_at: at(7 * 24 * 3600_000),
      send_error: null,
      send_claimed_at: null,
    });
    expect(db.table("leads")[0].status).toBe("sent");
    expect(db.table("send_log")).toHaveLength(1);
    expect(deps.logEvent).toHaveBeenCalledWith(db.client, USER, "mail_sent", { with_cv: true });
  });

  it("never sends a draft, an unapproved row, or a mail scheduled in the future", async () => {
    const { run, sendRawMessage } = setup([
      app({ id: "a-draft", status: "draft" }),
      app({ id: "a-noapproval", approved_at: null }),
      app({ id: "a-future", scheduled_for: at(60_000) }),
      app({ id: "a-unscheduled", scheduled_for: null }),
      app({ id: "a-sent", status: "sent" }),
    ]);
    expect(await run()).toEqual({ sent: 0, failed: 0, deferred: 0 });
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("only processes the given user when userId is set", async () => {
    const { run, sendRawMessage } = setup([
      app({ id: "other", user_id: OTHER, lead_id: "lead-2", contact_id: "contact-2" }),
    ]);
    expect(await run({ userId: USER })).toEqual({ sent: 0, failed: 0, deferred: 0 });
    expect(sendRawMessage).not.toHaveBeenCalled();
  });
});

describe("processSendQueue — content read under the claim", () => {
  it("sends the current subject/body, not the snapshot read before earlier sends", async () => {
    const { run, sendRawMessage, appRow } = setup([
      app({ id: "first", user_id: OTHER, lead_id: "lead-2", contact_id: "contact-2" }),
      app({ id: "second", scheduled_for: at(-500) }),
    ]);
    // While the first mail is being sent, the student edits the second one
    // (back to draft), validates and queues it again.
    sendRawMessage.mockImplementationOnce(async () => {
      Object.assign(appRow("second"), { subject: "Objet corrige", body: "Texte corrige." });
      return { id: "msg-1", threadId: "thread-1" };
    });
    expect(await run()).toEqual({ sent: 2, failed: 0, deferred: 0 });
    const raw = (sendRawMessage.mock.calls[1] as unknown as [string, string])[1];
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("Subject: Objet corrige");
    expect(mime).not.toContain("Alternance Business Analyst");
  });
});

describe("processSendQueue — claims", () => {
  it("leaves a mail claimed by a live worker alone", async () => {
    const { run, sendRawMessage } = setup([app({ send_claimed_at: at(-60_000) })]);
    expect(await run()).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("two concurrent workers send a mail only once", async () => {
    const { run, sendRawMessage, appRow } = setup([app()]);
    const results = await Promise.all([run(), run()]);
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(appRow().status).toBe("sent");
  });

  it("never resends a stale claim whose quota slot exists (mail may have left)", async () => {
    const { run, sendRawMessage, appRow } = setup([app({ send_claimed_at: at(-10 * 60_000) })], {
      send_log: [{ id: "s1", user_id: USER, application_id: "app-1", sent_at: at(-10 * 60_000) }],
    });
    expect(await run()).toEqual({ sent: 0, failed: 1, deferred: 0 });
    expect(sendRawMessage).not.toHaveBeenCalled();
    expect(appRow()).toMatchObject({
      status: "draft",
      approved_at: null,
      send_error: SEND_ERRORS.uncertain,
    });
  });

  it("retries a stale claim that never reserved a slot", async () => {
    const { run, sendRawMessage } = setup([app({ send_claimed_at: at(-10 * 60_000) })]);
    expect((await run()).sent).toBe(1);
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
  });
});

describe("processSendQueue — quota and spacing", () => {
  it("unschedules (keeps validated) when the 24 h quota is reached", async () => {
    const send_log = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      user_id: USER,
      application_id: null,
      sent_at: at(-3600_000),
    }));
    const { run, sendRawMessage, appRow } = setup(
      [app(), app({ id: "app-2", lead_id: "lead-1", scheduled_for: at(30_000) })],
      { send_log },
    );
    expect(await run()).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect(sendRawMessage).not.toHaveBeenCalled();
    for (const id of ["app-1", "app-2"]) {
      expect(appRow(id)).toMatchObject({
        status: "approved",
        scheduled_for: null,
        send_claimed_at: null,
        send_error: SEND_ERRORS.quota,
      });
    }
  });

  it("sends at most one mail per student per run and respects the 30 s gap", async () => {
    const { run, sendRawMessage } = setup([app(), app({ id: "app-2", scheduled_for: at(-500) })]);
    expect(await run()).toEqual({ sent: 1, failed: 0, deferred: 1 });
    // Next run 0 s later: the previous send is < 30 s old.
    expect(await run()).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
  });

  it("serves several students in one run", async () => {
    const { run, sendRawMessage } = setup([
      app(),
      app({ id: "other", user_id: OTHER, lead_id: "lead-2", contact_id: "contact-2" }),
    ]);
    expect((await run()).sent).toBe(2);
    expect(sendRawMessage).toHaveBeenCalledTimes(2);
  });

  it("stops after maxSends", async () => {
    const { run } = setup([
      app(),
      app({ id: "other", user_id: OTHER, lead_id: "lead-2", contact_id: "contact-2" }),
    ]);
    expect((await run({ maxSends: 1 })).sent).toBe(1);
  });
});

describe("processSendQueue — failures", () => {
  it("Gmail 5xx: back to draft with a French message and the slot released", async () => {
    const { run, deps, appRow, db } = setup([app()]);
    deps.sendRawMessage = vi.fn(async () => {
      throw new GmailSendError(503, null);
    });
    expect(await run()).toEqual({ sent: 0, failed: 1, deferred: 0 });
    expect(appRow()).toMatchObject({
      status: "draft",
      approved_at: null,
      scheduled_for: null,
      send_claimed_at: null,
      send_error: SEND_ERRORS.googleDown,
    });
    expect(db.table("send_log")).toHaveLength(0);
  });

  it("Gmail timeout: back to draft but the slot is kept (the mail may have left)", async () => {
    const { run, deps, appRow, db } = setup([app()]);
    deps.sendRawMessage = vi.fn(async () => {
      throw new GmailSendError(0, null);
    });
    await run();
    expect(appRow()).toMatchObject({ status: "draft", send_error: SEND_ERRORS.uncertain });
    expect(db.table("send_log")).toHaveLength(1);
  });

  it("Gmail 400: draft with a 'rejected' message", async () => {
    const { run, deps, appRow } = setup([app()]);
    deps.sendRawMessage = vi.fn(async () => {
      throw new GmailSendError(400, "invalidArgument");
    });
    await run();
    expect(appRow()).toMatchObject({ status: "draft", send_error: SEND_ERRORS.rejected });
  });

  it("Gmail not connected: queue of the student is paused, nothing sent, no crash", async () => {
    const { run, deps, appRow, sendRawMessage, db } = setup([
      app(),
      app({ id: "app-2", scheduled_for: at(60_000) }),
    ]);
    deps.getValidAccessToken = vi.fn(async () => {
      throw new GmailNotConnectedError("expired");
    });
    expect(await run()).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect(sendRawMessage).not.toHaveBeenCalled();
    for (const id of ["app-1", "app-2"]) {
      expect(appRow(id)).toMatchObject({
        status: "approved",
        scheduled_for: null,
        send_error: SEND_ERRORS.reconnect,
      });
    }
    expect(db.table("send_log")).toHaveLength(0);
  });

  it("Gmail 401: connection marked expired, mail kept validated", async () => {
    const { run, deps, appRow, db } = setup([app()], {
      google_connections: [{ user_id: USER, status: "active" }],
    });
    deps.sendRawMessage = vi.fn(async () => {
      throw new GmailSendError(401, "authError");
    });
    await run();
    expect(db.table("google_connections")[0].status).toBe("expired");
    expect(appRow()).toMatchObject({ status: "approved", send_error: SEND_ERRORS.reconnect });
    expect(db.table("send_log")).toHaveLength(0);
  });

  it("no valid contact or no CV: draft with a clear message, no quota used", async () => {
    const noContact = setup([app({ contact_id: null })]);
    await noContact.run();
    expect(noContact.appRow()).toMatchObject({
      status: "draft",
      send_error: SEND_ERRORS.noContact,
    });

    const noCv = setup([app()]);
    noCv.deps.downloadCv = vi.fn(async () => null);
    await noCv.run();
    expect(noCv.appRow()).toMatchObject({ status: "draft", send_error: SEND_ERRORS.noCv });
    expect(noCv.db.table("send_log")).toHaveLength(0);
    expect(noCv.sendRawMessage).not.toHaveBeenCalled();
  });

  it("refuses a CV path outside the student's folder", async () => {
    const { run, deps, appRow } = setup([app()], {
      profiles: [{ user_id: USER, full_name: "Léa", cv_storage_path: `${OTHER}/cv.pdf` }],
    });
    await run();
    expect(deps.downloadCv).not.toHaveBeenCalled();
    expect(appRow().send_error).toBe(SEND_ERRORS.noCv);
  });
});

describe("queueApprovedApplications", () => {
  it("schedules only validated, unscheduled mails, 30–90 s apart", async () => {
    const { db, appRow } = setup([
      app({ id: "a1", scheduled_for: null, approved_at: at(-3000) }),
      app({ id: "a2", scheduled_for: null, approved_at: at(-2000) }),
      app({ id: "a-draft", status: "draft", scheduled_for: null }),
      app({ id: "a-noapproval", approved_at: null, scheduled_for: null }),
      app({ id: "a-other", user_id: OTHER, scheduled_for: null }),
    ]);
    const out = await queueApprovedApplications(db.client, USER, undefined, {
      now: NOW,
      rand: () => 0,
    });
    expect(out).toEqual({ queued: 2, overQuota: 0 });
    expect(appRow("a1").scheduled_for).toBe(NOW.toISOString());
    expect(appRow("a2").scheduled_for).toBe(at(30_000));
    expect(appRow("a-draft").scheduled_for).toBeNull();
    expect(appRow("a-noapproval").scheduled_for).toBeNull();
    expect(appRow("a-other").scheduled_for).toBeNull();
  });

  it("caps to the remaining quota (sent + already queued)", async () => {
    const send_log = Array.from({ length: 18 }, (_, i) => ({
      id: `s${i}`,
      user_id: USER,
      sent_at: at(-3600_000),
    }));
    const { db } = setup(
      [
        app({ id: "queued", scheduled_for: at(120_000) }),
        app({ id: "b1", scheduled_for: null }),
        app({ id: "b2", scheduled_for: null }),
      ],
      { send_log },
    );
    const out = await queueApprovedApplications(db.client, USER, ["b1", "b2"], {
      now: NOW,
      rand: () => 0,
    });
    expect(out).toEqual({ queued: 1, overQuota: 1 });
    // Starts after the already queued mail.
    expect(db.table("applications").find((r) => r.id === "b1")!.scheduled_for).toBe(at(150_000));
  });

  it("does nothing for an empty id list", async () => {
    const { db } = setup([app({ scheduled_for: null })]);
    expect(await queueApprovedApplications(db.client, USER, [])).toEqual({
      queued: 0,
      overQuota: 0,
    });
  });
});
