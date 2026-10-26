import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GmailSendError } from "@/lib/integrations/gmail";
import { buildInterviewNotification, notifyInterview } from "@/lib/tracker/notify";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-10-26T10:00:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup(interviewNotifiedAt: string | null = null) {
  const db = createFakeSupabase({
    applications: [
      {
        id: "app-1",
        user_id: USER,
        status: "interview",
        interview_notified_at: interviewNotifiedAt,
      },
    ],
    send_log: [],
  });
  const sendRawMessage = vi.fn<
    (token: string, raw: string) => Promise<{ id: string; threadId: string }>
  >(async () => ({ id: "m-notif", threadId: "t-notif" }));
  const getValidAccessToken = vi.fn(async () => ({
    accessToken: "ya29.test",
    email: "lea.martin@gmail.com",
  }));
  const deps = {
    sendRawMessage,
    getValidAccessToken,
    appUrl: () => "https://app.example/",
    now: () => NOW,
  };
  const input = { userId: USER, applicationId: "app-1", companyName: "Acme Conseil" };
  return { db, deps, input, sendRawMessage };
}

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("buildInterviewNotification", () => {
  it("names the company and links to the board", () => {
    const n = buildInterviewNotification("Acme\r\nBcc: x@y.fr", "https://app.example/");
    expect(n.subject).toBe("Entretien proposé par Acme Bcc: x@y.fr – Spontané");
    expect(n.text).toContain("https://app.example/tracker");
    expect(n.text).toMatch(/Réponds vite/);
    expect(buildInterviewNotification(null, null).subject).toContain("une entreprise");
  });
});

describe("notifyInterview", () => {
  it("sends one mail to the student's own address, without attachment or quota", async () => {
    const { db, deps, input, sendRawMessage } = setup();
    expect(await notifyInterview(db.client, input, deps)).toBe("sent");
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
    const mime = decode(sendRawMessage.mock.calls[0][1]);
    expect(mime).toMatch(/^To: lea\.martin@gmail\.com$/m);
    expect(mime).toMatch(/<lea\.martin@gmail\.com>/);
    expect(mime).not.toMatch(/application\/pdf/);
    expect(db.table("applications")[0].interview_notified_at).toBe(NOW.toISOString());
    expect(db.table("send_log")).toHaveLength(0);
  });

  it("is idempotent: a second call sends nothing", async () => {
    const { db, deps, input, sendRawMessage } = setup();
    await notifyInterview(db.client, input, deps);
    expect(await notifyInterview(db.client, input, deps)).toBe("already_notified");
    expect(sendRawMessage).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when already notified", async () => {
    const { db, deps, input, sendRawMessage } = setup("2026-10-20T10:00:00.000Z");
    expect(await notifyInterview(db.client, input, deps)).toBe("already_notified");
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails, so a later run retries", async () => {
    const { db, deps, input, sendRawMessage } = setup();
    sendRawMessage.mockRejectedValueOnce(new GmailSendError(500, null));
    expect(await notifyInterview(db.client, input, deps)).toBe("failed");
    expect(db.table("applications")[0].interview_notified_at).toBeNull();
    expect(await notifyInterview(db.client, input, deps)).toBe("sent");
  });

  it("keeps the claim when the send outcome is unknown (never twice)", async () => {
    const { db, deps, input, sendRawMessage } = setup();
    sendRawMessage.mockRejectedValueOnce(new GmailSendError(0, null));
    expect(await notifyInterview(db.client, input, deps)).toBe("failed");
    expect(db.table("applications")[0].interview_notified_at).toBe(NOW.toISOString());
  });

  it("never logs the mail or the address", async () => {
    const { db, deps, input, sendRawMessage } = setup();
    sendRawMessage.mockRejectedValueOnce(new GmailSendError(500, null));
    await notifyInterview(db.client, input, deps);
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toMatch(/lea\.martin|Acme|ya29/);
  });
});
