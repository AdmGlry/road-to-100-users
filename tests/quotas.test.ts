import { describe, expect, it } from "vitest";

import {
  computeSendSchedule,
  getSendQuota,
  releaseSendSlot,
  reserveSendSlot,
  sendSpacingMs,
} from "@/lib/quotas";

import { createFakeSupabase } from "./helpers/fake-supabase";

const USER = "0a0a0a0a-0000-4000-8000-0000000000aa";
const OTHER = "0b0b0b0b-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3600_000;

describe("computeSendSchedule", () => {
  it("starts at startAt when nothing is queued, then spaces 30–90 s", () => {
    const times = computeSendSchedule(3, NOW, null, () => 0);
    expect(times.map((t) => t.getTime() - NOW.getTime())).toEqual([0, 30_000, 60_000]);
    const max = computeSendSchedule(2, NOW, null, () => 1);
    expect(max[1].getTime() - max[0].getTime()).toBe(90_000);
  });

  it("starts after the last scheduled send plus spacing when that is later", () => {
    const last = new Date(NOW.getTime() + 120_000);
    const [first] = computeSendSchedule(1, NOW, last, () => 0.5);
    expect(first.getTime()).toBe(last.getTime() + 60_000);
    const [early] = computeSendSchedule(1, NOW, new Date(NOW.getTime() - HOUR), () => 0.5);
    expect(early.getTime()).toBe(NOW.getTime());
  });

  it("returns nothing for count <= 0 and keeps random gaps in range", () => {
    expect(computeSendSchedule(0, NOW, null)).toEqual([]);
    const times = computeSendSchedule(20, NOW, null);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i].getTime() - times[i - 1].getTime();
      expect(gap).toBeGreaterThanOrEqual(30_000);
      expect(gap).toBeLessThanOrEqual(90_000);
    }
    expect(sendSpacingMs(() => 5)).toBe(90_000);
  });
});

describe("getSendQuota", () => {
  it("counts own sends of the last 24 h and queued mails", async () => {
    const { client } = createFakeSupabase({
      send_log: [
        { user_id: USER, sent_at: ago(HOUR) },
        { user_id: USER, sent_at: ago(23 * HOUR) },
        { user_id: USER, sent_at: ago(25 * HOUR) },
        { user_id: OTHER, sent_at: ago(HOUR) },
      ],
      applications: [
        { user_id: USER, status: "approved", scheduled_for: ago(-60_000) },
        { user_id: USER, status: "approved", scheduled_for: null },
        { user_id: USER, status: "draft", scheduled_for: null },
        { user_id: OTHER, status: "approved", scheduled_for: ago(0) },
      ],
    });
    expect(await getSendQuota(client, USER, NOW)).toEqual({
      used: 2,
      limit: 20,
      queued: 1,
      remaining: 17,
    });
  });

  it("never returns a negative remaining", async () => {
    const send_log = Array.from({ length: 22 }, () => ({ user_id: USER, sent_at: ago(HOUR) }));
    const { client } = createFakeSupabase({ send_log });
    expect((await getSendQuota(client, USER, NOW)).remaining).toBe(0);
  });
});

describe("reserveSendSlot / releaseSendSlot", () => {
  it("calls reserve_send_slot with the limit and returns the slot id or null", async () => {
    const args: unknown[] = [];
    let answer: string | null = "slot-1";
    const { client } = createFakeSupabase(
      {},
      {
        rpc: (name, a) => {
          args.push({ name, ...a });
          return answer;
        },
      },
    );
    expect(await reserveSendSlot(client, USER, "app-1")).toBe("slot-1");
    answer = null;
    expect(await reserveSendSlot(client, USER, "app-1")).toBeNull();
    expect(args[0]).toEqual({
      name: "reserve_send_slot",
      p_user: USER,
      p_application: "app-1",
      p_limit: 20,
    });
  });

  it("throws when the RPC fails (never sends without a slot)", async () => {
    const { client } = createFakeSupabase();
    await expect(reserveSendSlot(client, USER, "app-1")).rejects.toThrow(/reserve_send_slot/);
  });

  it("deletes the slot on release", async () => {
    const { client, table } = createFakeSupabase({
      send_log: [{ id: "s1", user_id: USER }, { id: "s2", user_id: USER }],
    });
    await releaseSendSlot(client, "s1");
    expect(table("send_log").map((r) => r.id)).toEqual(["s2"]);
  });
});
