import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logEvent } from "@/lib/events";
import { setLlmProviderForTests, type LlmProvider } from "@/lib/llm/client";
import { PROMPT_VERSION } from "@/lib/llm/prompts/extract-profile";
import { CvError } from "@/lib/profile/parse-cv";
import { loadEditableProfile, processStoredCv, saveProfilePatch } from "@/lib/profile/service";

import { readCvPdf, readExpected } from "./fixtures/cv";

const USER = "00000000-0000-0000-0000-0000000000aa";

type Call = { table: string; op: string; payload?: unknown; filter?: [string, unknown] };

/** Minimal chainable fake of the Supabase client (storage + from()). */
function fakeSupabase(opts: {
  file?: Uint8Array | null;
  row?: Record<string, unknown> | null;
  updateError?: { code: string } | null;
  insertThrows?: boolean;
}) {
  const calls: Call[] = [];
  const downloads: string[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push(`${bucket}/${path}`);
          return opts.file
            ? { data: new Blob([opts.file as BlobPart]), error: null }
            : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
    from: (table: string) => ({
      insert: async (payload: unknown) => {
        if (opts.insertThrows) throw new Error("network");
        calls.push({ table, op: "insert", payload });
        return { error: null };
      },
      update: (payload: unknown) => ({
        eq: async (col: string, val: unknown) => {
          calls.push({ table, op: "update", payload, filter: [col, val] });
          return { error: opts.updateError ?? null };
        },
      }),
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => {
            calls.push({ table, op: "select", filter: [col, val] });
            return { data: opts.row ?? null, error: null };
          },
        }),
      }),
    }),
  };
  return { supabase: client as unknown as SupabaseClient, calls, downloads };
}

function provider(text: string): LlmProvider {
  return { complete: vi.fn(async () => ({ text, inputTokens: 1000, outputTokens: 300 })) };
}

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_MODEL_FAST", "model-fast");
  vi.stubEnv("LLM_MODEL_SMART", "model-smart");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setLlmProviderForTests(undefined);
});

describe("processStoredCv", () => {
  it("downloads the CV, stores its text and logs events without content", async () => {
    const expected = readExpected("cv-dev");
    setLlmProviderForTests(
      provider(JSON.stringify({ ...expected, skills: [...expected.skills, "Rust"] })),
    );
    const { supabase, calls, downloads } = fakeSupabase({ file: readCvPdf("cv-dev") });

    const result = await processStoredCv(supabase, USER);

    expect(downloads).toEqual([`cvs/${USER}/cv.pdf`]);
    expect(result.extracted).toEqual(expected);
    expect(result.removedCount).toBe(1);
    expect(result.cvText).toContain("Inès Garnier");

    const update = calls.find((c) => c.table === "profiles" && c.op === "update")!;
    expect(update.filter).toEqual(["user_id", USER]);
    expect(update.payload).toEqual({ cv_text: result.cvText, cv_storage_path: `${USER}/cv.pdf` });

    const events = calls.filter((c) => c.table === "events").map((c) => c.payload);
    expect(events).toEqual([
      {
        user_id: USER,
        name: "llm_usage",
        props: expect.objectContaining({
          prompt: "extract_profile",
          model: "model-fast",
          input_tokens: 1000,
          output_tokens: 300,
        }),
      },
      {
        user_id: USER,
        name: "cv_uploaded",
        props: { chars: result.cvText.length, removed_count: 1, prompt_version: PROMPT_VERSION },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Garnier");
  });

  it("throws not_found when the file is missing", async () => {
    const { supabase } = fakeSupabase({ file: null });
    const err = await processStoredCv(supabase, USER).catch((e) => e);
    expect(err).toBeInstanceOf(CvError);
    expect((err as CvError).code).toBe("not_found");
  });

  it("throws too_short for a scanned CV, before calling the LLM", async () => {
    const llm = provider("{}");
    setLlmProviderForTests(llm);
    const { supabase, calls } = fakeSupabase({ file: readCvPdf("cv-scanned") });
    const err = await processStoredCv(supabase, USER).catch((e) => e);
    expect((err as CvError).code).toBe("too_short");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("loadEditableProfile", () => {
  it("returns an empty profile when the row is missing", async () => {
    const { supabase } = fakeSupabase({ row: null });
    const res = await loadEditableProfile(supabase, USER);
    expect(res.hasCv).toBe(false);
    expect(res.updatedAt).toBeNull();
    expect(res.profile.skills).toEqual([]);
  });

  it("maps the row and reports hasCv / updatedAt", async () => {
    const { supabase, calls } = fakeSupabase({
      row: {
        city: "Nantes",
        experiences: "bad",
        cv_storage_path: `${USER}/cv.pdf`,
        updated_at: "2026-10-25T10:00:00Z",
      },
    });
    const res = await loadEditableProfile(supabase, USER);
    expect(calls[0].filter).toEqual(["user_id", USER]);
    expect(res.profile.city).toBe("Nantes");
    expect(res.profile.experiences).toEqual([]);
    expect(res.hasCv).toBe(true);
    expect(res.updatedAt).toBe("2026-10-25T10:00:00Z");
  });
});

describe("saveProfilePatch", () => {
  it("updates only the given columns of the user's row", async () => {
    const { supabase, calls } = fakeSupabase({});
    await saveProfilePatch(supabase, USER, { city: "Rennes", search_radius_km: 50 });
    expect(calls).toEqual([
      {
        table: "profiles",
        op: "update",
        payload: { city: "Rennes", search_radius_km: 50 },
        filter: ["user_id", USER],
      },
    ]);
  });

  it("rejects unknown keys and invalid values", async () => {
    const { supabase, calls } = fakeSupabase({});
    await expect(saveProfilePatch(supabase, USER, { user_id: "x" } as never)).rejects.toThrow();
    await expect(saveProfilePatch(supabase, USER, { search_radius_km: -1 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("does nothing for an empty patch, throws on DB error", async () => {
    const empty = fakeSupabase({});
    await saveProfilePatch(empty.supabase, USER, {});
    expect(empty.calls).toEqual([]);
    const failing = fakeSupabase({ updateError: { code: "42501" } });
    await expect(saveProfilePatch(failing.supabase, USER, { city: "Lyon" })).rejects.toThrow(
      "42501",
    );
  });
});

describe("logEvent", () => {
  it("swallows errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = fakeSupabase({ insertThrows: true });
    await expect(logEvent(supabase, USER, "cv_uploaded", { chars: 1 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
