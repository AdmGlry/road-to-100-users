import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER = { id: "0a0a0a0a-0000-4000-8000-0000000000aa" };
const ID = "a0a0a0a0-0000-4000-8000-000000000001";
const STATE = {
  cards: [],
  stats: { sent: 0, replied: 0, replyRate: 0, interviews: 0, pendingFollowups: 0 },
  gmail: { state: "active", email: "moi@gmail.com", missingScopes: false },
  lastSyncAt: null,
};

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  userClient: { tag: "user" },
  adminThrows: false,
  admin: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...h.userClient,
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error("missing key");
    return h.admin;
  },
}));
vi.mock("@/lib/google/connection", () => ({ getGmailStatus: vi.fn() }));
vi.mock("@/lib/tracker/sync", () => ({ syncReplies: vi.fn() }));
vi.mock("@/lib/tracker/followups", () => {
  class FollowupError extends Error {
    constructor(
      readonly code: string,
      readonly userMessage = "Cette relance a déjà été envoyée.",
    ) {
      super(code);
    }
  }
  return {
    FollowupError,
    updateFollowup: vi.fn(),
    dismissFollowup: vi.fn(),
    sendFollowup: vi.fn(),
  };
});
vi.mock("@/lib/tracker/board", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracker/board")>();
  return { ...actual, loadTrackerState: vi.fn(), moveCard: vi.fn(), reviseBounced: vi.fn() };
});

import {
  dismissFollowupAction,
  moveCardAction,
  refreshTrackerAction,
  reviseBouncedAction,
  sendFollowupAction,
  syncNowAction,
  updateFollowupAction,
} from "@/app/(app)/tracker/actions";
import { getGmailStatus } from "@/lib/google/connection";
import * as board from "@/lib/tracker/board";
import * as followups from "@/lib/tracker/followups";
import { syncReplies } from "@/lib/tracker/sync";

import { createFakeSupabase } from "./helpers/fake-supabase";

let fake: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  h.user = USER;
  h.adminThrows = false;
  fake = createFakeSupabase({ events: [] });
  h.admin = fake.client;
  vi.mocked(board.loadTrackerState).mockResolvedValue(STATE as never);
  vi.mocked(getGmailStatus).mockResolvedValue(STATE.gmail as never);
  vi.mocked(syncReplies).mockResolvedValue({ users: 1, threads: 3, newReplies: 2, errors: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("session and validation", () => {
  it("refuses every action without a session", async () => {
    h.user = null;
    for (const res of [
      await refreshTrackerAction(),
      await syncNowAction(),
      await moveCardAction(ID, "interview"),
      await moveCardAction(ID, "nope" as never),
      await reviseBouncedAction(ID),
      await updateFollowupAction(ID, { subject: "Re", body: "Texte" }),
      await updateFollowupAction(ID, { body: "" }),
      await sendFollowupAction(ID),
      await dismissFollowupAction(ID),
    ]) {
      expect(res).toEqual({ ok: false, message: expect.stringContaining("session") });
    }
    expect(board.moveCard).not.toHaveBeenCalled();
    expect(syncReplies).not.toHaveBeenCalled();
    expect(followups.sendFollowup).not.toHaveBeenCalled();
  });

  it("rejects malformed ids, columns and contents before any write", async () => {
    expect((await moveCardAction("1 OR 1=1", "interview")).ok).toBe(false);
    expect((await moveCardAction(ID, "draft" as never)).ok).toBe(false);
    expect((await reviseBouncedAction("x")).ok).toBe(false);
    expect((await sendFollowupAction("x")).ok).toBe(false);
    expect((await updateFollowupAction(ID, { subject: "Re", body: "   " })).ok).toBe(false);
    expect((await updateFollowupAction(ID, { body: "x".repeat(2001) })).ok).toBe(false);
    expect(board.moveCard).not.toHaveBeenCalled();
    expect(board.reviseBounced).not.toHaveBeenCalled();
    expect(followups.updateFollowup).not.toHaveBeenCalled();
    expect(followups.sendFollowup).not.toHaveBeenCalled();
  });

  it("reports a missing service key", async () => {
    h.adminThrows = true;
    expect((await moveCardAction(ID, "interview")).ok).toBe(false);
  });
});

describe("delegation", () => {
  it("loads the state with the user client and the session user id", async () => {
    expect(await refreshTrackerAction()).toEqual({ ok: true, state: STATE });
    expect(board.loadTrackerState).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "user" }),
      USER.id,
    );
  });

  it("moves and revises on the admin client with the session user id", async () => {
    expect(await moveCardAction(ID, "rejected")).toEqual({ ok: true, state: STATE });
    expect(board.moveCard).toHaveBeenCalledWith(fake.client, USER.id, ID, "rejected");
    expect((await reviseBouncedAction(ID)).ok).toBe(true);
    expect(board.reviseBounced).toHaveBeenCalledWith(fake.client, USER.id, ID);
  });

  it("returns the French message of a TrackerError", async () => {
    vi.mocked(board.moveCard).mockRejectedValue(new board.TrackerError("not_found"));
    expect(await moveCardAction(ID, "rejected")).toEqual({
      ok: false,
      message: "Cette candidature est introuvable. Recharge la page.",
    });
  });

  it("normalises the follow-up and delegates the edit, send and dismiss", async () => {
    await updateFollowupAction(ID, { subject: " Re:\nCandidature ", body: " Bonjour\r\nMerci " });
    expect(followups.updateFollowup).toHaveBeenCalledWith(fake.client, USER.id, ID, {
      subject: "Re: Candidature",
      body: "Bonjour\nMerci",
    });
    expect((await sendFollowupAction(ID)).ok).toBe(true);
    expect(followups.sendFollowup).toHaveBeenCalledWith(fake.client, USER.id, ID);
    expect((await dismissFollowupAction(ID)).ok).toBe(true);
    expect(followups.dismissFollowup).toHaveBeenCalledWith(fake.client, USER.id, ID);
  });

  it("refuses to send a follow-up when Gmail is not usable", async () => {
    vi.mocked(getGmailStatus).mockResolvedValue({
      state: "expired",
      email: null,
      missingScopes: false,
    });
    expect((await sendFollowupAction(ID)).ok).toBe(false);
    expect(followups.sendFollowup).not.toHaveBeenCalled();
  });

  it("returns the message of a FollowupError and never logs contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(followups.sendFollowup).mockRejectedValue(
      // The module mock above gives FollowupError a (code, message) constructor.
      new (followups.FollowupError as unknown as new (code: string, message: string) => Error)(
        "not_sendable",
        "Cette relance a déjà été envoyée.",
      ),
    );
    expect(await sendFollowupAction(ID)).toEqual({
      ok: false,
      message: "Cette relance a déjà été envoyée.",
    });
    vi.mocked(followups.updateFollowup).mockRejectedValue(new Error("secret@mail.fr corps"));
    await updateFollowupAction(ID, { body: "Texte" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret@mail.fr");
  });
});

describe("syncNowAction", () => {
  it("requires an active Gmail connection", async () => {
    vi.mocked(getGmailStatus).mockResolvedValue({
      state: "active",
      email: "x",
      missingScopes: true,
    });
    expect((await syncNowAction()).ok).toBe(false);
    expect(syncReplies).not.toHaveBeenCalled();
  });

  it("runs the sync for the session user with a 25 s budget and logs manual_sync", async () => {
    const res = await syncNowAction();
    expect(res).toEqual({ ok: true, state: STATE, newReplies: 2 });
    expect(syncReplies).toHaveBeenCalledWith(fake.client, { userId: USER.id, deadlineMs: 25_000 });
    expect(fake.table("events")).toEqual([
      expect.objectContaining({ user_id: USER.id, name: "manual_sync" }),
    ]);
  });

  it("enforces the cooldown per user", async () => {
    fake.table("events").push({
      id: "e1",
      user_id: USER.id,
      name: "manual_sync",
      props: {},
      created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    });
    const res = await syncNowAction();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("3 minutes");
    expect(syncReplies).not.toHaveBeenCalled();
  });

  it("ignores old syncs and other users' syncs", async () => {
    fake.table("events").push(
      {
        id: "e1",
        user_id: USER.id,
        name: "manual_sync",
        created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      },
      {
        id: "e2",
        user_id: "someone-else",
        name: "manual_sync",
        created_at: new Date().toISOString(),
      },
    );
    expect((await syncNowAction()).ok).toBe(true);
    expect(syncReplies).toHaveBeenCalledTimes(1);
  });

  it("returns a French message when the sync fails", async () => {
    vi.mocked(syncReplies).mockRejectedValue(new Error("gmail 500"));
    const res = await syncNowAction();
    expect(res).toEqual({ ok: false, message: expect.stringContaining("synchronisation") });
  });
});
