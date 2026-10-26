import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GmailNotConnectedError } from "@/lib/google/connection";
import { GmailReadError, GmailSendError, type ThreadMessageMeta } from "@/lib/integrations/gmail";
import type { LlmProvider } from "@/lib/llm/client";
import type { EditableProfile } from "@/lib/profile/schema";
import {
  dismissFollowup,
  FOLLOWUP_ERRORS,
  FollowupError,
  generateFollowups,
  markNoReply,
  originalMessageId,
  sendFollowup,
  updateFollowup,
  type FollowupDeps,
} from "@/lib/tracker/followups";

import { createFakeSupabase } from "./helpers/fake-supabase";
import { PROFILE } from "./fixtures/enrich";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const APP = "1a1a1a1a-0000-4000-8000-000000000001";
const APP2 = "1a1a1a1a-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-26T07:10:00.000Z");
const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

type Row = Record<string, unknown>;

/** A body of exactly `n` words. */
const words = (n: number) =>
  ["Bonjour Jean Dupont,", ...Array.from({ length: n - 5 }, () => "mot"), "Camille Durand"].join(
    " ",
  );

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

function app(overrides: Row = {}): Row {
  return {
    id: APP,
    user_id: USER,
    lead_id: "lead-1",
    contact_id: "contact-1",
    subject: "Alternance Business Analyst – Acme",
    body: "Bonjour Jean Dupont,\n\nJe candidate. 06 12 34 56 78\n\nCamille Durand",
    status: "sent",
    sent_at: ago(8 * DAY),
    gmail_message_id: "msg-orig",
    gmail_thread_id: "thread-1",
    last_reply_at: null,
    next_followup_at: ago(DAY),
    followup_count: 0,
    followup_status: null,
    followup_subject: null,
    followup_body: null,
    followup_error: null,
    followup_approved_at: null,
    followup_sent_at: null,
    status_set_manually: false,
    ...overrides,
  };
}

function draft(overrides: Row = {}): Row {
  return app({
    followup_status: "draft",
    followup_subject: "Re: Alternance Business Analyst – Acme",
    followup_body: words(60),
    ...overrides,
  });
}

function scripted(answers: unknown[]) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    async complete(req) {
      prompts.push(`${req.system}\n${req.messages.map((m) => m.content).join("\n")}`);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return { text: JSON.stringify(a), inputTokens: 100, outputTokens: 80 };
    },
  };
  return { provider, prompts };
}

const THREAD: ThreadMessageMeta[] = [
  {
    id: "msg-orig",
    internalDate: 1,
    labelIds: ["SENT"],
    from: "Camille <camille@gmail.com>",
    subject: "Alternance Business Analyst – Acme",
    messageIdHeader: "<CAorig123@mail.gmail.com>",
    autoHeaders: {},
    snippet: "",
  },
];

function setup(applications: Row[], extra: Record<string, Row[]> = {}, answers: unknown[] = []) {
  const db = createFakeSupabase(
    {
      applications,
      contacts: [
        {
          id: "contact-1",
          user_id: USER,
          first_name: "Jean",
          last_name: "Dupont",
          email: "jean.dupont@acme.fr",
        },
      ],
      leads: [{ id: "lead-1", user_id: USER, company_id: "co-1" }],
      companies: [{ id: "co-1", name: "Acme" }],
      profiles: [{ user_id: USER, full_name: "Camille Durand" }],
      google_connections: [
        { user_id: USER, status: "active" },
        { user_id: OTHER, status: "expired" },
      ],
      send_log: [],
      events: [],
      ...extra,
    },
    {
      rpc: (name, args) => {
        if (name !== "reserve_send_slot") throw new Error("unexpected rpc");
        const since = new Date(NOW.getTime() - DAY).toISOString();
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
  const { provider, prompts } = scripted(answers);
  const sendRawMessage = vi.fn(async () => ({ id: "msg-followup", threadId: "thread-1" }));
  const getThreadMetadata = vi.fn(async () => THREAD);
  const logEvent = vi.fn(async () => {});
  const deps: Partial<FollowupDeps> = {
    getValidAccessToken: vi.fn(async () => ({
      accessToken: "ya29.token",
      email: "camille@gmail.com",
    })),
    getThreadMetadata,
    sendRawMessage,
    logEvent,
    loadProfile: async () => PROFILE as EditableProfile,
    provider,
  };
  const appRow = (id = APP) => db.table("applications").find((r) => r.id === id)!;
  const generate = (o: Parameters<typeof generateFollowups>[1] = {}) =>
    generateFollowups(db.client, { now: () => NOW, deps, ...o });
  const send = (id = APP) => sendFollowup(db.client, USER, id, { now: () => NOW, deps });
  return { db, deps, prompts, sendRawMessage, getThreadMetadata, logEvent, appRow, generate, send };
}

async function expectFollowupError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FollowupError);
  expect((err as FollowupError).code).toBe(code);
  return err as FollowupError;
}

// ---------------------------------------------------------------------------

describe("generateFollowups — selection", () => {
  it("drafts a follow-up 7 days after the send, subject Re: original, events without content", async () => {
    const { generate, appRow, prompts, logEvent } = setup([app()], {}, [{ body: words(60) }]);
    expect(await generate()).toEqual({ drafted: 1, failed: 0 });
    expect(appRow()).toMatchObject({
      followup_status: "draft",
      followup_subject: "Re: Alternance Business Analyst – Acme",
      followup_body: words(60),
      followup_error: null,
    });
    // Prompt: contact, company, student; no phone / e-mail of the student.
    expect(prompts[0]).toContain("Jean Dupont");
    expect(prompts[0]).toContain("Acme");
    expect(prompts[0]).toContain("Camille Durand");
    expect(prompts[0]).not.toContain("06 12 34 56 78");
    expect(prompts[0]).not.toContain("camille@example.com");
    const names = logEvent.mock.calls.map((c) => (c as unknown[])[2]);
    expect(names).toEqual(["llm_usage", "followup_drafted"]);
    for (const c of logEvent.mock.calls) {
      expect(JSON.stringify((c as unknown[])[3])).not.toMatch(/mot mot|Acme|Jean/);
    }
  });

  it("skips mails sent less than 7 days ago, replied, manual, followed up, without thread or inactive Gmail", async () => {
    const { generate, prompts } = setup([
      app({ id: "recent", sent_at: ago(6 * DAY) }),
      app({ id: "replied", last_reply_at: ago(DAY) }),
      app({ id: "manual", status_set_manually: true }),
      app({ id: "followed", followup_count: 1 }),
      app({ id: "dismissed", followup_status: "dismissed" }),
      app({ id: "nothread", gmail_thread_id: null }),
      app({ id: "status", status: "replied" }),
      app({ id: "other", user_id: OTHER }),
    ]);
    expect(await generate()).toEqual({ drafted: 0, failed: 0 });
    expect(prompts).toHaveLength(0);
  });

  it("is idempotent: a second run drafts nothing", async () => {
    const { generate, prompts } = setup([app()], {}, [{ body: words(60) }, { body: words(60) }]);
    expect(await generate()).toEqual({ drafted: 1, failed: 0 });
    expect(await generate()).toEqual({ drafted: 0, failed: 0 });
    expect(prompts).toHaveLength(1);
  });

  it("regenerates once when the word count is out of range", async () => {
    const { generate, appRow, prompts } = setup([app()], {}, [
      { body: words(120) },
      { body: words(70) },
    ]);
    expect(await generate()).toEqual({ drafted: 1, failed: 0 });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("La relance fait 120 mots");
    expect(appRow()).toMatchObject({ followup_body: words(70), followup_error: null });
  });

  it("stores the draft anyway with the remaining problem after one regeneration", async () => {
    const { generate, appRow, prompts } = setup([app()], {}, [
      { body: `${words(60)} motivé` },
      { body: `${words(60)} dynamique` },
    ]);
    expect(await generate()).toEqual({ drafted: 1, failed: 0 });
    expect(prompts).toHaveLength(2);
    expect(appRow().followup_status).toBe("draft");
    expect(appRow().followup_error).toMatch(/Formules creuses/);
  });

  it("one failure never stops the others, respects the limit", async () => {
    const { generate, appRow } = setup(
      [app({ id: APP, sent_at: ago(9 * DAY) }), app({ id: APP2 })],
      {},
      [new Error("request failed"), { body: words(60) }],
    );
    expect(await generate()).toEqual({ drafted: 1, failed: 1 });
    expect(appRow(APP).followup_status).toBeNull();
    expect(appRow(APP2).followup_status).toBe("draft");
  });

  it("limit bounds the run", async () => {
    const { generate, prompts } = setup([app({ id: APP }), app({ id: APP2 })], {}, [
      { body: words(60) },
      { body: words(60) },
    ]);
    expect(await generate({ limit: 1 })).toEqual({ drafted: 1, failed: 0 });
    expect(prompts).toHaveLength(1);
  });

  it("recovers stale sending claims: uncertain when a slot exists, silent otherwise", async () => {
    const { generate, appRow } = setup(
      [
        draft({ id: APP, followup_status: "sending", followup_approved_at: ago(10 * 60_000) }),
        draft({ id: APP2, followup_status: "sending", followup_approved_at: ago(10 * 60_000) }),
      ],
      {
        send_log: [
          { id: "s-orig", user_id: USER, application_id: APP2, sent_at: ago(8 * DAY) },
          { id: "s-f", user_id: USER, application_id: APP, sent_at: ago(9 * 60_000) },
        ],
      },
    );
    await generate();
    expect(appRow(APP)).toMatchObject({
      followup_status: "draft",
      followup_error: FOLLOWUP_ERRORS.uncertain,
      followup_approved_at: null,
    });
    expect(appRow(APP2)).toMatchObject({ followup_status: "draft", followup_error: null });
  });

  it("leaves a fresh sending claim alone", async () => {
    const { generate, appRow } = setup([
      draft({ followup_status: "sending", followup_approved_at: ago(60_000) }),
    ]);
    await generate();
    expect(appRow().followup_status).toBe("sending");
  });
});

describe("markNoReply", () => {
  it("marks no_reply 21 days after the send with one follow-up and no reply", async () => {
    const { db, appRow } = setup([
      app({ id: "due", sent_at: ago(22 * DAY), followup_count: 1, followup_status: "sent" }),
      app({ id: "early", sent_at: ago(20 * DAY), followup_count: 1, followup_status: "sent" }),
      app({ id: "nofollowup", sent_at: ago(22 * DAY) }),
      app({ id: "replied", sent_at: ago(22 * DAY), followup_count: 1, last_reply_at: ago(DAY) }),
      app({ id: "manual", sent_at: ago(22 * DAY), followup_count: 1, status_set_manually: true }),
    ]);
    expect(await markNoReply(db.client, { now: () => NOW })).toBe(1);
    expect(appRow("due").status).toBe("no_reply");
    for (const id of ["early", "nofollowup", "replied", "manual"]) {
      expect(appRow(id).status).toBe("sent");
    }
  });

  it("dismisses drafts never validated for 14 days", async () => {
    const { db, appRow } = setup([
      draft({ id: "old", sent_at: ago(22 * DAY) }),
      draft({ id: "young", sent_at: ago(10 * DAY) }),
    ]);
    await markNoReply(db.client, { now: () => NOW });
    expect(appRow("old").followup_status).toBe("dismissed");
    expect(appRow("young").followup_status).toBe("draft");
  });
});

describe("updateFollowup / dismissFollowup", () => {
  it("saves edits of a draft and clears the validation", async () => {
    const { db, appRow } = setup([draft({ followup_approved_at: ago(1000) })]);
    const saved = await updateFollowup(db.client, USER, APP, {
      subject: "  Re: Ma candidature ",
      body: " Bonjour,\r\nmerci. ",
    });
    expect(saved).toEqual({ subject: "Re: Ma candidature", body: "Bonjour,\nmerci." });
    expect(appRow().followup_approved_at).toBeNull();
  });

  it("rejects invalid input", async () => {
    const { db } = setup([draft()]);
    await expectFollowupError(updateFollowup(db.client, USER, APP, { body: "  " }), "invalid");
    await expectFollowupError(
      updateFollowup(db.client, USER, APP, { subject: "a\r\nBcc: x@y.fr", body: "ok" }),
      "invalid",
    );
    await expectFollowupError(
      updateFollowup(db.client, USER, APP, { subject: "x".repeat(121), body: "ok" }),
      "invalid",
    );
    await expectFollowupError(
      updateFollowup(db.client, USER, APP, { body: "x".repeat(3001) }),
      "invalid",
    );
  });

  it("refuses non-drafts and other students' rows", async () => {
    const { db } = setup([
      draft({ id: APP, followup_status: "sent" }),
      draft({ id: APP2, user_id: OTHER }),
    ]);
    await expectFollowupError(updateFollowup(db.client, USER, APP, { body: "ok" }), "locked");
    await expectFollowupError(updateFollowup(db.client, USER, APP2, { body: "ok" }), "not_found");
    await expectFollowupError(dismissFollowup(db.client, USER, APP), "locked");
    await expectFollowupError(dismissFollowup(db.client, USER, "nope"), "not_found");
  });

  it("dismisses a draft", async () => {
    const { db, appRow } = setup([draft()]);
    await dismissFollowup(db.client, USER, APP);
    expect(appRow().followup_status).toBe("dismissed");
  });
});

describe("sendFollowup", () => {
  it("sends in the same thread with In-Reply-To / References and consumes a slot", async () => {
    const { send, sendRawMessage, appRow, db, logEvent } = setup([draft()]);
    expect(await send()).toEqual({ sent: true });

    expect(sendRawMessage).toHaveBeenCalledTimes(1);
    const [token, raw, o] = sendRawMessage.mock.calls[0] as unknown as [
      string,
      string,
      { threadId?: string },
    ];
    expect(token).toBe("ya29.token");
    expect(o).toEqual({ threadId: "thread-1" });
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: jean.dupont@acme.fr");
    expect(mime).toContain("In-Reply-To: <CAorig123@mail.gmail.com>");
    expect(mime).toContain("References: <CAorig123@mail.gmail.com>");
    expect(mime).not.toContain("application/pdf");

    expect(db.table("send_log")).toHaveLength(1);
    expect(appRow()).toMatchObject({
      followup_status: "sent",
      followup_sent_at: NOW.toISOString(),
      followup_approved_at: NOW.toISOString(),
      followup_count: 1,
      next_followup_at: null,
      followup_error: null,
      status: "sent",
    });
    expect(logEvent).toHaveBeenCalledWith(db.client, USER, "followup_sent", {
      same_thread: true,
      in_reply_to: true,
    });
  });

  it("never sends a 'Re:' without In-Reply-To when the thread cannot be read", async () => {
    const { send, sendRawMessage, getThreadMetadata, appRow } = setup([draft()]);
    getThreadMetadata.mockRejectedValueOnce(new GmailReadError(403, "insufficientPermissions"));
    await expectFollowupError(send(), "google_down");
    expect(sendRawMessage).not.toHaveBeenCalled();
    expect(appRow().followup_status).toBe("draft");
  });

  it("refuses when the thread holds a reply that is not synced yet", async () => {
    const { send, sendRawMessage, getThreadMetadata } = setup([draft()]);
    getThreadMetadata.mockResolvedValueOnce([
      ...THREAD,
      { ...THREAD[0], id: "new-reply", labelIds: ["INBOX"], from: "rh@acme.example" },
    ]);
    await expectFollowupError(send(), "new_reply");
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("falls back to the first SENT message for the Message-ID", () => {
    const other = { ...THREAD[0], id: "x", messageIdHeader: "<sent2@mail.gmail.com>" };
    expect(originalMessageId([other], "missing")).toBe("<sent2@mail.gmail.com>");
    expect(originalMessageId([{ ...other, messageIdHeader: "bad id" }], null)).toBeNull();
    expect(originalMessageId([{ ...other, labelIds: ["INBOX"] }], null)).toBeNull();
  });

  it("refuses when not a draft, already sent, or replied (no Gmail call)", async () => {
    const { send, sendRawMessage } = setup([
      draft({ id: APP, followup_status: "dismissed" }),
      draft({ id: APP2, last_reply_at: ago(DAY) }),
    ]);
    await expectFollowupError(send(APP), "not_sendable");
    await expectFollowupError(send(APP2), "not_sendable");
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("never sends twice: a second click after success is refused", async () => {
    const { send, sendRawMessage } = setup([draft()]);
    await send();
    await expectFollowupError(send(), "not_sendable");
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
  });

  it("reports a send already in progress", async () => {
    const { send } = setup([draft({ followup_status: "sending", followup_approved_at: ago(1) })]);
    await expectFollowupError(send(), "in_progress");
  });

  it("uncertain send (status 0) keeps the slot and is never resent automatically", async () => {
    const { send, sendRawMessage, appRow, db, generate } = setup([draft()]);
    sendRawMessage.mockRejectedValueOnce(new GmailSendError(0, null));
    const err = await expectFollowupError(send(), "uncertain");
    expect(err.userMessage).toBe(FOLLOWUP_ERRORS.uncertain);
    expect(db.table("send_log")).toHaveLength(1);
    expect(appRow()).toMatchObject({
      followup_status: "draft",
      followup_error: FOLLOWUP_ERRORS.uncertain,
      followup_approved_at: null,
      followup_count: 0,
    });
    await generate();
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
  });

  it("401 → reconnect message, slot released, connection expired", async () => {
    const { send, sendRawMessage, appRow, db } = setup([draft()]);
    sendRawMessage.mockRejectedValueOnce(new GmailSendError(401, null));
    await expectFollowupError(send(), "reconnect");
    expect(db.table("send_log")).toHaveLength(0);
    expect(db.table("google_connections")[0].status).toBe("expired");
    expect(appRow()).toMatchObject({
      followup_status: "draft",
      followup_error: FOLLOWUP_ERRORS.reconnect,
    });
  });

  it("maps other Gmail errors and releases the slot", async () => {
    const cases: [GmailSendError, string][] = [
      [new GmailSendError(429, null), "rate_limited"],
      [new GmailSendError(503, null), "google_down"],
      [new GmailSendError(400, "invalidArgument"), "rejected"],
      [new GmailSendError(403, "insufficientPermissions"), "scopes"],
    ];
    for (const [error, code] of cases) {
      const { send, sendRawMessage, db, appRow } = setup([draft()]);
      sendRawMessage.mockRejectedValueOnce(error);
      await expectFollowupError(send(), code);
      expect(db.table("send_log")).toHaveLength(0);
      expect(appRow().followup_status).toBe("draft");
    }
  });

  it("Gmail not connected → reconnect, no quota used, no send", async () => {
    const { send, sendRawMessage, db, deps } = setup([draft()]);
    deps.getValidAccessToken = vi.fn(async () => {
      throw new GmailNotConnectedError("expired");
    });
    await expectFollowupError(send(), "reconnect");
    expect(sendRawMessage).not.toHaveBeenCalled();
    expect(db.table("send_log")).toHaveLength(0);
  });

  it("quota full → error, no Gmail call", async () => {
    const full = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      user_id: USER,
      application_id: null,
      sent_at: ago(3600_000),
    }));
    const { send, sendRawMessage, appRow } = setup([draft()], { send_log: full });
    await expectFollowupError(send(), "quota");
    expect(sendRawMessage).not.toHaveBeenCalled();
    expect(appRow()).toMatchObject({
      followup_status: "draft",
      followup_error: FOLLOWUP_ERRORS.quota,
    });
  });

  it("no valid recipient → no_contact, nothing sent", async () => {
    const { send, sendRawMessage } = setup([draft({ contact_id: null })]);
    await expectFollowupError(send(), "no_contact");
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("rejects ids that are not uuids", async () => {
    const { send } = setup([draft()]);
    await expectFollowupError(send("app-1"), "not_found");
  });
});
