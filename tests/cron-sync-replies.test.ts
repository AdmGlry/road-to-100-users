import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncReplies = vi.fn();
vi.mock("@/lib/tracker/sync", () => ({ syncReplies }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ fake: true }) }));

const { POST, maxDuration } = await import("@/app/api/cron/sync-replies/route");

const SECRET = "s3cr3t-value-for-tests";
const call = (auth?: string) =>
  POST(
    new Request("https://app.example/api/cron/sync-replies", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  syncReplies.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/cron/sync-replies", () => {
  it("declares a 60 s max duration", () => {
    expect(maxDuration).toBe(60);
  });

  it("rejects missing or wrong secrets without syncing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(syncReplies).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("syncs with a 50 s deadline and returns counts only", async () => {
    const counts = { users: 2, threads: 5, newReplies: 1, errors: 0 };
    syncReplies.mockResolvedValue(counts);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(counts);
    expect(syncReplies).toHaveBeenCalledWith({ fake: true }, { deadlineMs: 50_000 });
  });

  it("returns 500 (no details) when the sync cannot start", async () => {
    syncReplies.mockRejectedValue(new Error("boom"));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
  });
});
