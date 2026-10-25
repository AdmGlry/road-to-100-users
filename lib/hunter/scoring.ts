/**
 * LLM fit scoring (prompt `score_fit`, SPEC §7.2 step 2): batches of 10,
 * 3 batches in flight. A batch that fails (after generateJson's 2 attempts)
 * falls back to the pre-filter score; companies the model skipped too.
 */
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  BATCH_SIZE,
  buildScoreFitPrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
  type ScoreFitOutput,
  type ScoreFitProfile,
} from "@/lib/llm/prompts/score-fit";

import { mapWithConcurrency } from "./concurrency";
import type { PrefilteredCompany } from "./prefilter";

export const FALLBACK_REASON = "Score estimé (IA indisponible)";
// Free OpenRouter models rate-limit quickly: 2 concurrent batches.
export const SCORING_CONCURRENCY = 2;
const MAX_REASON_WORDS = 8;
const MAX_REASONS = 3;

export type ScoredCompany = PrefilteredCompany & {
  fit_score: number;
  fit_reasons: string[];
  fit_source: "llm" | "fallback";
};

export type ScoreOptions = {
  provider?: LlmProvider;
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
  batchSize?: number;
  concurrency?: number;
  /** Called after each batch (success or fallback) with the number of batches done. */
  onBatchDone?: (done: number, total: number) => void | Promise<void>;
};

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function cleanReasons(reasons: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of reasons) {
    const words = r.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const text = words
      .slice(0, MAX_REASON_WORDS)
      .join(" ")
      .replace(/[,;:]$/, "")
      .slice(0, 80);
    if (!out.includes(text)) out.push(text);
    if (out.length >= MAX_REASONS) break;
  }
  return out;
}

export function fallbackScore(c: PrefilteredCompany): ScoredCompany {
  return {
    ...c,
    fit_score: clampScore(c.prefilter_score),
    fit_reasons: [FALLBACK_REASON],
    fit_source: "fallback",
  };
}

/** Applies a model output to its batch: unknown sirens ignored, missing ones fall back. */
export function applyScoreOutput(
  batch: readonly PrefilteredCompany[],
  output: ScoreFitOutput,
): ScoredCompany[] {
  const bySiren = new Map<string, { score: number; reasons: string[] }>();
  for (const r of output.results) {
    if (bySiren.has(r.siren)) continue;
    const reasons = cleanReasons(r.reasons);
    if (reasons.length === 0) continue;
    bySiren.set(r.siren, { score: clampScore(r.score), reasons });
  }
  return batch.map((c) => {
    const r = bySiren.get(c.siren);
    return r
      ? { ...c, fit_score: r.score, fit_reasons: r.reasons, fit_source: "llm" as const }
      : fallbackScore(c);
  });
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function scoreCompanies(
  profile: ScoreFitProfile,
  companies: readonly PrefilteredCompany[],
  opts: ScoreOptions = {},
): Promise<{ scored: ScoredCompany[]; failedBatches: number; promptVersion: string }> {
  const batches = chunk(companies, opts.batchSize ?? BATCH_SIZE);
  let done = 0;
  let failedBatches = 0;

  const results = await mapWithConcurrency(
    batches,
    opts.concurrency ?? SCORING_CONCURRENCY,
    async (batch) => {
      let scored: ScoredCompany[];
      try {
        const { system, prompt } = buildScoreFitPrompt(
          profile,
          batch.map((c) => ({
            siren: c.siren,
            name: c.name,
            activity: c.naf_label,
            headcount: c.headcount_label,
            city: c.establishment?.city ?? null,
          })),
        );
        const { data } = await generateJson({
          system,
          prompt,
          schema: outputSchema,
          tier: MODEL_TIER,
          maxTokens: MAX_TOKENS,
          promptName: PROMPT_NAME,
          promptVersion: PROMPT_VERSION,
          provider: opts.provider,
          onUsage: opts.onUsage,
        });
        scored = applyScoreOutput(batch, data);
      } catch {
        failedBatches++;
        scored = batch.map(fallbackScore);
      }
      done++;
      try {
        await opts.onBatchDone?.(done, batches.length);
      } catch {
        // progress reporting must not break scoring
      }
      return scored;
    },
  );

  return { scored: results.flat(), failedBatches, promptVersion: PROMPT_VERSION };
}
