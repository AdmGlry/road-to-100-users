import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GmailNotConnectedError } from "@/lib/google/connection";
import { GmailReadError, type ThreadMessageMeta } from "@/lib/integrations/gmail";
import { ruleClassify } from "@/lib/tracker/classify";
import { syncReplies, toSnippet, type SyncDeps } from "@/lib/tracker/sync";
import type { ClassifiedReply, ReplyClassification } from "@/lib/tracker/types";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-26T10:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000).toISOString();
const STUDENT = { [USER]: "lea.martin@example.com", [OTHER]: "tom.durand@example.com" };

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
    status: "sent",
    gmail_thread_id: "thread-1",
    gmail_message_id: "msg-sent",
    sent_at: daysAgo(3),
    last_reply_at: null,
    status_set_manually: false,
    followup_status: null,
    interview_notified_at: null,
    ...overrides,
  };
}

function msg(id: string, overrides: Partial<ThreadMessageMeta> = {}): ThreadMessageMeta {
  return {
    id,
    internalDate: NOW.getTime() - 3600_000,
    labelIds: ["INBOX"],
    from: '"Claire Moreau" <Claire.Moreau@acme.fr>',
    subject: "Re: Alternance – Acme",
    messageIdHeader: `<${id}@acme.fr>`,
    autoHeaders: {},
    snippet: "",
    ...overrides,
  };
}

const ORIGINAL = msg("msg-sent", {
  labelIds: ["SENT"],
  from: "Léa Martin <lea.martin@example.com>",
  internalDate: NOW.getTime() - 3 * 24 * 3600_000,
});

function setup(opts: {
  applications?: Row[];
  connections?: Row[];
  threads?: Record<string, ThreadMessageMeta[] | Error>;
  texts?: Record<string, string>;
  classify?: ReplyClassification;
}) {
  const db = createFakeSupabase({
    google_connections: opts.connections ?? [
      { user_id: USER, status: "active", google_email: STUDENT[USER], last_sync_at: null },
    ],
    applications: opts.applications ?? [app()],
    replies: [],
    leads: [{ id: "lead-1", user_id: USER, company_id: "co-1" }],
    companies: [{ id: "co-1", name: "Acme Conseil" }],
    events: [],
  });
  const threads = opts.threads ?? { "thread-1": [ORIGINAL, msg("msg-reply")] };
  const texts = opts.texts ?? {};
  const deps = {
    getValidAccessToken: vi.fn(async (_admin: unknown, userId: string) => ({
      accessToken: `token-${userId}`,
      email: STUDENT[userId as keyof typeof STUDENT],
    })),
    getThreadMetadata: vi.fn(async (_token: string, threadId: string) => {
      const t = threads[threadId];
      if (t instanceof Error) throw t;
      return t ?? [];
    }),
    getMessageText: vi.fn(
      async (_token: string, id: string) =>
        texts[id] ?? "Bonjour,\n\nSeriez-vous disponible mardi pour un échange ?\n\nClaire",
    ),
    classifyReply: vi.fn(async (input): Promise<ClassifiedReply> => {
      const rule = ruleClassify(input);
      if (rule) return rule;
      return {
        classification: opts.classify ?? "interview",
        confidence: 0.9,
        suggested_action: "Réponds vite en proposant deux créneaux.",
        source: "llm",
      };
    }),
    notifyInterview: vi.fn(async () => "sent"),
    logEvent: vi.fn(async () => {}),
  } satisfies SyncDeps;
  const run = (extra: { userId?: string; deadlineMs?: number } = {}) =>
    syncReplies(db.client, { now: () => NOW, deps, ...extra });
  return { db, deps, run };
}

describe("toSnippet", () => {
  it("flattens and caps at 200 characters", () => {
    expect(toSnippet("a\n\nb")).toBe("a b");
    expect(toSnippet("x".repeat(500))).toHaveLength(200);
    expect(toSnippet("  ")).toBeNull();
  });
});

describe("syncReplies", () => {
  it("stores a new reply and updates the application", async () => {
    const { db, deps, run } = setup({});
    expect(await run()).toEqual({ users: 1, threads: 1, newReplies: 1, errors: 0 });

    const replies = db.table("replies");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      user_id: USER,
      application_id: "app-1",
      gmail_message_id: "msg-reply",
      from_email: "claire.moreau@acme.fr",
      classification: "interview",
      classification_confidence: 0.9,
      received_at: new Date(NOW.getTime() - 3600_000).toISOString(),
    });
    expect((replies[0].snippet as string).length).toBeLessThanOrEqual(200);
    expect(replies[0].snippet).toContain("Seriez-vous disponible");

    const a = db.table("applications")[0];
    expect(a.status).toBe("interview");
    expect(a.last_reply_at).toBe(replies[0].received_at);
    expect(db.table("google_connections")[0].last_sync_at).toBe(NOW.toISOString());
    expect(deps.logEvent).toHaveBeenCalledWith(db.client, USER, "reply_received", {
      classification: "interview",
      source: "llm",
    });
    // Only the app's thread was read, only the new message in full.
    expect(deps.getThreadMetadata).toHaveBeenCalledWith(`token-${USER}`, "thread-1");
    expect(deps.getMessageText).toHaveBeenCalledTimes(1);
    expect(deps.getMessageText).toHaveBeenCalledWith(`token-${USER}`, "msg-reply");
  });

  it("is idempotent: a second run creates no duplicate", async () => {
    const { db, deps, run } = setup({});
    await run();
    expect(await run()).toEqual({ users: 1, threads: 1, newReplies: 0, errors: 0 });
    expect(db.table("replies")).toHaveLength(1);
    expect(deps.getMessageText).toHaveBeenCalledTimes(1);
    expect(deps.notifyInterview).toHaveBeenCalledTimes(1);
  });

  it("treats a unique-violation on insert as already stored", async () => {
    const { db, deps } = setup({});
    const racing = createFakeSupabase(
      {},
      {
        tables: db.tables,
        failOn: (t, op) =>
          t === "replies" && op === "insert" ? { code: "23505", message: "dup" } : null,
      },
    );
    const result = await syncReplies(racing.client, { now: () => NOW, deps });
    expect(result).toEqual({ users: 1, threads: 1, newReplies: 0, errors: 0 });
    expect(db.table("applications")[0].status).toBe("sent");
  });

  it("ignores the student's own messages (SENT label, own address, drafts)", async () => {
    const { db, deps, run } = setup({
      threads: {
        "thread-1": [
          ORIGINAL,
          msg("msg-followup", { labelIds: ["SENT"], from: "Léa <lea.martin@example.com>" }),
          msg("msg-other-client", { labelIds: ["INBOX"], from: "LEA.MARTIN@EXAMPLE.COM" }),
          msg("msg-draft", { labelIds: ["DRAFT"] }),
        ],
      },
    });
    expect(await run()).toEqual({ users: 1, threads: 1, newReplies: 0, errors: 0 });
    expect(db.table("replies")).toHaveLength(0);
    expect(deps.getMessageText).not.toHaveBeenCalled();
  });

  it("respects a status set manually by the student", async () => {
    const { db, run } = setup({ applications: [app({ status_set_manually: true })] });
    await run();
    const a = db.table("applications")[0];
    expect(a.status).toBe("sent");
    expect(a.last_reply_at).not.toBeNull();
    expect(db.table("replies")).toHaveLength(1);
  });

  it("leaves the status and last_reply_at untouched on an auto-reply", async () => {
    const { db, run } = setup({
      applications: [app({ followup_status: "draft" })],
      threads: {
        "thread-1": [
          ORIGINAL,
          msg("msg-auto", { autoHeaders: { "auto-submitted": "auto-replied" } }),
        ],
      },
    });
    await run();
    const a = db.table("applications")[0];
    expect(a.status).toBe("sent");
    expect(a.last_reply_at).toBeNull();
    expect(a.followup_status).toBe("draft");
    expect(db.table("replies")[0].classification).toBe("auto_reply");
  });

  it("dismisses a pending follow-up draft on a real reply, never a sent one", async () => {
    const { db, run } = setup({
      classify: "info_request",
      applications: [
        app({ followup_status: "draft" }),
        app({ id: "app-2", gmail_thread_id: "thread-2", followup_status: "sent" }),
      ],
      threads: {
        "thread-1": [ORIGINAL, msg("r1")],
        "thread-2": [msg("msg-sent-2", { labelIds: ["SENT"] }), msg("r2")],
      },
    });
    await run();
    const [a1, a2] = db.table("applications");
    expect(a1).toMatchObject({ status: "replied", followup_status: "dismissed" });
    expect(a2).toMatchObject({ status: "replied", followup_status: "sent" });
  });

  it("marks a bounce", async () => {
    const { db, deps, run } = setup({
      threads: {
        "thread-1": [
          ORIGINAL,
          msg("bounce", {
            from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
            subject: "Delivery Status Notification (Failure)",
          }),
        ],
      },
    });
    await run();
    expect(db.table("applications")[0].status).toBe("bounced");
    expect(db.table("replies")[0]).toMatchObject({ classification: "bounce" });
    expect(deps.notifyInterview).not.toHaveBeenCalled();
  });

  it("notifies an interview once, with the company name", async () => {
    const { db, deps, run } = setup({
      threads: { "thread-1": [ORIGINAL, msg("r1"), msg("r2")] },
    });
    await run();
    expect(db.table("replies")).toHaveLength(2);
    expect(deps.notifyInterview).toHaveBeenCalledTimes(1);
    expect(deps.notifyInterview).toHaveBeenCalledWith(db.client, {
      userId: USER,
      applicationId: "app-1",
      companyName: "Acme Conseil",
    });
  });

  it("does not notify an application already notified", async () => {
    const { deps, run } = setup({
      applications: [app({ interview_notified_at: daysAgo(1) })],
    });
    await run();
    expect(deps.notifyInterview).not.toHaveBeenCalled();
  });

  it("never downgrades an interview", async () => {
    const { db, run } = setup({ classify: "other", applications: [app({ status: "interview" })] });
    await run();
    expect(db.table("applications")[0].status).toBe("interview");
  });

  it("skips threads outside the window, unsent applications and inactive connections", async () => {
    const { deps, run } = setup({
      connections: [
        { user_id: USER, status: "active", last_sync_at: null },
        { user_id: OTHER, status: "expired", last_sync_at: null },
      ],
      applications: [
        app({ sent_at: daysAgo(61) }),
        app({ id: "app-2", status: "approved", gmail_thread_id: null, sent_at: null }),
        app({ id: "app-3", user_id: OTHER, gmail_thread_id: "thread-3" }),
      ],
    });
    expect(await run()).toEqual({ users: 0, threads: 0, newReplies: 0, errors: 0 });
    expect(deps.getValidAccessToken).not.toHaveBeenCalled();
  });

  it("skips a deleted thread (404)", async () => {
    const { db, run } = setup({ threads: { "thread-1": new GmailReadError(404, "notFound") } });
    expect(await run()).toEqual({ users: 1, threads: 0, newReplies: 0, errors: 0 });
    expect(db.table("google_connections")[0].last_sync_at).toBe(NOW.toISOString());
  });

  it("marks the connection expired on a 401 and stops that student", async () => {
    const { db, deps, run } = setup({
      applications: [app(), app({ id: "app-2", gmail_thread_id: "thread-2" })],
      threads: { "thread-1": new GmailReadError(401, null), "thread-2": [ORIGINAL, msg("r2")] },
    });
    expect(await run()).toMatchObject({ newReplies: 0, errors: 1 });
    expect(db.table("google_connections")[0]).toMatchObject({
      status: "expired",
      last_sync_at: null,
    });
    expect(deps.getThreadMetadata).toHaveBeenCalledTimes(1);
  });

  it("skips a student whose Gmail is no longer connected", async () => {
    const { deps, run } = setup({});
    deps.getValidAccessToken.mockRejectedValueOnce(new GmailNotConnectedError("expired"));
    expect(await run()).toEqual({ users: 0, threads: 0, newReplies: 0, errors: 0 });
    expect(deps.getThreadMetadata).not.toHaveBeenCalled();
  });

  it("one failing student does not block another", async () => {
    const { db, deps, run } = setup({
      connections: [
        { user_id: USER, status: "active", last_sync_at: null },
        { user_id: OTHER, status: "active", last_sync_at: daysAgo(1) },
      ],
      applications: [
        app({ gmail_thread_id: "thread-1" }),
        app({ id: "app-2", user_id: OTHER, lead_id: null, gmail_thread_id: "thread-2" }),
      ],
      threads: {
        "thread-1": new GmailReadError(500, "backendError"),
        "thread-2": [msg("msg-sent", { labelIds: ["SENT"] }), msg("r-other")],
      },
    });
    expect(await run()).toEqual({ users: 2, threads: 1, newReplies: 1, errors: 1 });
    expect(db.table("replies")).toEqual([
      expect.objectContaining({ user_id: OTHER, application_id: "app-2" }),
    ]);
    const conns = db.table("google_connections");
    expect(conns.find((c) => c.user_id === USER)?.last_sync_at).toBeNull();
    expect(conns.find((c) => c.user_id === OTHER)?.last_sync_at).toBe(NOW.toISOString());
    expect(deps.getValidAccessToken).toHaveBeenCalledTimes(2);
  });

  it("a transient token failure counts an error and goes on", async () => {
    const { deps, run } = setup({});
    deps.getValidAccessToken.mockRejectedValueOnce(new Error("google down"));
    expect(await run()).toEqual({ users: 0, threads: 0, newReplies: 0, errors: 1 });
  });

  it("restricts to one student when userId is given", async () => {
    const { deps, run } = setup({
      connections: [
        { user_id: USER, status: "active", last_sync_at: null },
        { user_id: OTHER, status: "active", last_sync_at: null },
      ],
      applications: [app(), app({ id: "app-2", user_id: OTHER, gmail_thread_id: "thread-2" })],
    });
    await run({ userId: OTHER });
    expect(deps.getValidAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.getValidAccessToken).toHaveBeenCalledWith(expect.anything(), OTHER);
  });

  it("stops starting new work after the deadline; the next run resumes", async () => {
    const { db, run } = setup({});
    expect(await run({ deadlineMs: -1 })).toEqual({
      users: 0,
      threads: 0,
      newReplies: 0,
      errors: 0,
    });
    expect(db.table("replies")).toHaveLength(0);
    expect(await run()).toMatchObject({ newReplies: 1 });
  });

  it("never logs reply contents or addresses", async () => {
    const { deps, run } = setup({
      threads: { "thread-1": [ORIGINAL, msg("r1")] },
    });
    deps.getMessageText.mockRejectedValueOnce(new GmailReadError(500, null));
    expect(await run()).toMatchObject({ errors: 1, newReplies: 0 });
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toMatch(/acme|lea\.martin|Seriez|token-/i);
  });
});
