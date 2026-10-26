import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processSendQueue = vi.fn();
vi.mock("@/lib/hunter/send", () => ({ processSendQueue }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ fake: true }) }));

const { POST, maxDuration } = await import("@/app/api/cron/send-queue/route");
const { isAuthorizedCron } = await import("@/lib/auth/cron");

const SECRET = "s3cr3t-value-for-tests";
const call = (auth?: string) =>
  POST(
    new Request("https://app.example/api/cron/send-queue", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  processSendQueue.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isAuthorizedCron", () => {
  it("accepts only the exact Bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});

describe("POST /api/cron/send-queue", () => {
  it("declares a 60 s max duration", () => {
    expect(maxDuration).toBe(60);
  });

  it("rejects missing or wrong secrets without running the queue", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(processSendQueue).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("runs the queue with a 50 s deadline and returns counts only", async () => {
    processSendQueue.mockResolvedValue({ sent: 2, failed: 1, deferred: 0 });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, failed: 1, deferred: 0 });
    expect(processSendQueue).toHaveBeenCalledWith({ fake: true }, { deadlineMs: 50_000 });
  });

  it("returns 500 (no details) when the queue cannot be read", async () => {
    processSendQueue.mockRejectedValue(new Error("boom"));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
  });
});
