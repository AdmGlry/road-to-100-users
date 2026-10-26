import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markNoReply = vi.fn();
const generateFollowups = vi.fn();
vi.mock("@/lib/tracker/followups", () => ({ markNoReply, generateFollowups }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ fake: true }) }));

const { POST, maxDuration } = await import("@/app/api/cron/followups/route");

/** Same value as the route (one slow composition must end before 60 s). */
const FOLLOWUP_CRON_DEADLINE_MS = 25_000;

const SECRET = "s3cr3t-value-for-tests";
const call = (auth?: string) =>
  POST(
    new Request("https://app.example/api/cron/followups", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  markNoReply.mockReset();
  generateFollowups.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/cron/followups", () => {
  it("declares a 60 s max duration", () => {
    expect(maxDuration).toBe(60);
  });

  it("rejects missing or wrong secrets without running anything", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(markNoReply).not.toHaveBeenCalled();
    expect(generateFollowups).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("marks no_reply then drafts follow-ups, returns counts only", async () => {
    const order: string[] = [];
    markNoReply.mockImplementation(async () => {
      order.push("noReply");
      return 3;
    });
    generateFollowups.mockImplementation(async () => {
      order.push("generate");
      return { drafted: 2, failed: 1 };
    });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ noReply: 3, drafted: 2, failed: 1 });
    expect(order).toEqual(["noReply", "generate"]);
    expect(generateFollowups).toHaveBeenCalledWith(
      { fake: true },
      { deadlineMs: FOLLOWUP_CRON_DEADLINE_MS },
    );
  });

  it("returns 500 (no details) on failure", async () => {
    markNoReply.mockRejectedValue(new Error("boom"));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
  });
});
