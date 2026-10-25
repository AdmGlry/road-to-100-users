/**
 * Roles / sectors → NAF codes (prompt `map_naf`, validated against naf.json).
 * Never fails: falls back to the hand-written hints when the LLM is unavailable
 * or returns fewer than 2 valid codes.
 */
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildMapNafPrompt,
  MAX_CODES,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
  type MapNafOutput,
} from "@/lib/llm/prompts/map-naf";

import {
  getNafEntry,
  hintCodesFor,
  normalizeNafCode,
  preselectNafCandidates,
  type NafCandidateInput,
} from "./naf";
import { GENERIC_FALLBACK_CODES } from "./role-naf-hints";

export type NafChoice = { code: string; label: string; reason: string };

export type MapNafResult = {
  codes: NafChoice[];
  source: "llm" | "fallback";
  promptVersion: string;
};

export type MapNafOptions = {
  provider?: LlmProvider;
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
};

export const MIN_VALID_CODES = 2;
const FALLBACK_REASON = "Activité typique pour ce rôle";

/** Keeps valid, deduplicated NAF codes (max MAX_CODES), in the model's order. */
export function validateNafOutput(output: MapNafOutput): NafChoice[] {
  const out: NafChoice[] = [];
  for (const item of output.codes) {
    const code = normalizeNafCode(item.code);
    const entry = code ? getNafEntry(code) : null;
    if (!entry || out.some((c) => c.code === entry.code)) continue;
    out.push({ code: entry.code, label: entry.label, reason: item.reason.trim().slice(0, 120) });
    if (out.length >= MAX_CODES) break;
  }
  return out;
}

/** Hint codes for the roles/sectors; else the top keyword candidates; else generic codes. */
export function fallbackNafCodes(input: NafCandidateInput): NafChoice[] {
  let codes = hintCodesFor([...input.roles, ...input.sectors]);
  if (codes.length < MIN_VALID_CODES) {
    codes = [
      ...codes,
      ...preselectNafCandidates(input, 8)
        .map((e) => e.code)
        .filter((c) => !GENERIC_FALLBACK_CODES.includes(c)),
    ];
  }
  if (codes.length < MIN_VALID_CODES) codes = [...codes, ...GENERIC_FALLBACK_CODES];
  const out: NafChoice[] = [];
  for (const code of codes) {
    const entry = getNafEntry(code);
    if (entry && !out.some((c) => c.code === entry.code)) {
      out.push({ code: entry.code, label: entry.label, reason: FALLBACK_REASON });
    }
    if (out.length >= MAX_CODES) break;
  }
  return out;
}

export async function mapRolesToNaf(
  input: NafCandidateInput,
  opts: MapNafOptions = {},
): Promise<MapNafResult> {
  const candidates = preselectNafCandidates(input);
  const { system, prompt } = buildMapNafPrompt({ ...input, candidates });
  try {
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
    const codes = validateNafOutput(data);
    if (codes.length >= MIN_VALID_CODES) {
      return { codes, source: "llm", promptVersion: PROMPT_VERSION };
    }
  } catch {
    // LLM unavailable / invalid JSON twice / missing config: deterministic fallback.
  }
  return { codes: fallbackNafCodes(input), source: "fallback", promptVersion: PROMPT_VERSION };
}
