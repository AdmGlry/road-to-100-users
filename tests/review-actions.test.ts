import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER = { id: "0a0a0a0a-0000-4000-8000-0000000000aa" };
const ID = "a0a0a0a0-0000-4000-8000-000000000001";
const STATE = {
  items: [],
  preparing: [],
  quota: { used: 0, limit: 20, queued: 0, remaining: 20 },
  gmail: { state: "active", email: "moi@gmail.com", missingScopes: false },
};

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  afterCallbacks: [] as (() => Promise<void> | void)[],
  userClient: { tag: "user" },
  adminClient: { tag: "admin" },
  adminThrows: false,
}));

vi.mock("next/server", () => ({
  after: (cb: () => Promise<void> | void) => h.afterCallbacks.push(cb),
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
    return h.adminClient;
  },
}));
vi.mock("@/lib/google/connection", () => ({ getGmailStatus: vi.fn() }));
vi.mock("@/lib/hunter/prepare", async () => {
  class PrepareError extends Error {
    constructor(
      readonly code: string,
      readonly userMessage = "Complète ton profil.",
    ) {
      super(code);
    }
  }
  return {
    PrepareError,
    queuePreparation: vi.fn(),
    runPreparation: vi.fn(),
    regenerateApplication: vi.fn(),
  };
});
vi.mock("@/lib/hunter/send", () => ({
  queueApprovedApplications: vi.fn(),
  processSendQueue: vi.fn(),
}));
vi.mock("@/lib/hunter/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hunter/review")>();
  return {
    ...actual,
    loadReviewState: vi.fn(),
    needsPreparationRun: vi.fn(),
    hasDueSends: vi.fn(),
    updateApplication: vi.fn(),
    approveApplication: vi.fn(),
    unapproveApplication: vi.fn(),
    dismissApplication: vi.fn(),
    dismissFailedLead: vi.fn(),
    changeContact: vi.fn(),
    prepareRegeneration: vi.fn(),
  };
});

import {
  approveApplicationAction,
  changeContactAction,
  continuePreparationAction,
  processMyQueueAction,
  regenerateApplicationAction,
  sendApprovedAction,
  startPreparationAction,
  updateApplicationAction,
} from "@/app/(app)/hunter/review/actions";
import { getGmailStatus } from "@/lib/google/connection";
import { queuePreparation, regenerateApplication, runPreparation } from "@/lib/hunter/prepare";
import * as review from "@/lib/hunter/review";
import { processSendQueue, queueApprovedApplications } from "@/lib/hunter/send";

const runAfter = async () => {
  const cbs = h.afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
  return cbs.length;
};

beforeEach(() => {
  h.user = USER;
  h.adminThrows = false;
  h.afterCallbacks = [];
  vi.mocked(review.loadReviewState).mockResolvedValue(STATE as never);
  vi.mocked(getGmailStatus).mockResolvedValue(STATE.gmail as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("session and validation", () => {
  it("refuses every action without a session", async () => {
    h.user = null;
    expect(await approveApplicationAction(ID)).toEqual({
      ok: false,
      message: expect.stringContaining("session"),
    });
    expect((await sendApprovedAction([ID])).ok).toBe(false);
    expect(review.approveApplication).not.toHaveBeenCalled();
    expect(queueApprovedApplications).not.toHaveBeenCalled();
  });

  it("rejects malformed ids and contents before touching the database", async () => {
    expect((await approveApplicationAction("1 OR 1=1")).ok).toBe(false);
    expect((await updateApplicationAction(ID, { subject: "", body: "x" })).ok).toBe(false);
    expect((await changeContactAction(ID, { email: "nope" })).ok).toBe(false);
    expect(review.updateApplication).not.toHaveBeenCalled();
    expect(review.changeContact).not.toHaveBeenCalled();
  });

  it("uses the session user id and the user client", async () => {
    await approveApplicationAction(ID);
    expect(review.approveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "user" }),
      USER.id,
      ID,
    );
  });

  it("returns the French message of a ReviewError", async () => {
    vi.mocked(review.approveApplication).mockRejectedValue(new review.ReviewError("no_contact"));
    expect(await approveApplicationAction(ID)).toEqual({
      ok: false,
      message: "Ajoute une adresse de destinataire avant de valider ce mail.",
    });
  });
});

describe("preparation", () => {
  it("queues the leads and runs the preparation in after() with the admin client", async () => {
    vi.mocked(queuePreparation).mockResolvedValue({ queued: 2 });
    const res = await startPreparationAction([ID, ID]);
    expect(res).toEqual({ ok: true, queued: 2, requested: 1 });
    expect(runPreparation).not.toHaveBeenCalled();
    expect(await runAfter()).toBe(1);
    expect(runPreparation).toHaveBeenCalledWith(h.adminClient, USER.id, { deadlineMs: 240_000 });
  });

  it("reports a missing service key and an incomplete profile", async () => {
    h.adminThrows = true;
    expect((await startPreparationAction([ID])).ok).toBe(false);
    h.adminThrows = false;
    const { PrepareError } = await import("@/lib/hunter/prepare");
    vi.mocked(queuePreparation).mockRejectedValue(new PrepareError("profile_incomplete"));
    expect(await startPreparationAction([ID])).toEqual({
      ok: false,
      message: "Complète ton profil.",
    });
  });

  it("restarts a stopped run only when needed", async () => {
    vi.mocked(review.needsPreparationRun).mockResolvedValue(false);
    expect((await continuePreparationAction()).ok).toBe(true);
    expect(await runAfter()).toBe(0);
    vi.mocked(review.needsPreparationRun).mockResolvedValue(true);
    await continuePreparationAction();
    expect(await runAfter()).toBe(1);
  });
});

describe("regeneration", () => {
  it("checks ownership with the user client before using the admin client", async () => {
    vi.mocked(review.prepareRegeneration).mockRejectedValue(new review.ReviewError("not_found"));
    expect((await regenerateApplicationAction(ID)).ok).toBe(false);
    expect(regenerateApplication).not.toHaveBeenCalled();

    vi.mocked(review.prepareRegeneration).mockResolvedValue();
    expect((await regenerateApplicationAction(ID)).ok).toBe(true);
    expect(regenerateApplication).toHaveBeenCalledWith(h.adminClient, USER.id, ID);
  });
});

describe("sending", () => {
  it("refuses to send when Gmail is not connected or misses a scope", async () => {
    vi.mocked(getGmailStatus).mockResolvedValue({
      state: "expired",
      email: null,
      missingScopes: false,
    });
    expect((await sendApprovedAction([ID])).ok).toBe(false);
    vi.mocked(getGmailStatus).mockResolvedValue({
      state: "active",
      email: "x",
      missingScopes: true,
    });
    expect((await sendApprovedAction([ID])).ok).toBe(false);
    expect(queueApprovedApplications).not.toHaveBeenCalled();
  });

  it("queues exactly the confirmed ids then processes the queue in after()", async () => {
    vi.mocked(queueApprovedApplications).mockResolvedValue({ queued: 1, overQuota: 0 });
    const res = await sendApprovedAction([ID]);
    expect(res).toMatchObject({ ok: true, queued: 1, overQuota: 0 });
    expect(queueApprovedApplications).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "user" }),
      USER.id,
      [ID],
    );
    expect(processSendQueue).not.toHaveBeenCalled();
    await runAfter();
    expect(processSendQueue).toHaveBeenCalledWith(h.adminClient, {
      userId: USER.id,
      deadlineMs: 50_000,
    });
  });

  it("requires at least one confirmed id", async () => {
    expect((await sendApprovedAction([])).ok).toBe(false);
  });

  it("processes the queue only when mails are due and Gmail is active", async () => {
    vi.mocked(review.hasDueSends).mockResolvedValue(false);
    await processMyQueueAction();
    expect(await runAfter()).toBe(0);

    vi.mocked(review.hasDueSends).mockResolvedValue(true);
    vi.mocked(getGmailStatus).mockResolvedValue({
      state: "revoked",
      email: null,
      missingScopes: false,
    });
    await processMyQueueAction();
    expect(await runAfter()).toBe(0);

    vi.mocked(getGmailStatus).mockResolvedValue(STATE.gmail as never);
    const res = await processMyQueueAction();
    expect(res.ok).toBe(true);
    expect(await runAfter()).toBe(1);
    expect(processSendQueue).toHaveBeenCalledWith(h.adminClient, {
      userId: USER.id,
      deadlineMs: 50_000,
    });
  });

  it("never logs messages, only names and codes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(queueApprovedApplications).mockRejectedValue(new Error("secret@mail.fr body"));
    await sendApprovedAction([ID]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret@mail.fr");
  });
});
