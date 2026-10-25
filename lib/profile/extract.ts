/**
 * CV text → grounded ExtractedProfile (prompt `extract_profile`, SPEC §5.2).
 * SERVER ONLY. Never logs the CV or the model output.
 */
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildExtractProfilePrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
} from "@/lib/llm/prompts/extract-profile";

import { groundProfile } from "./grounding";
import { CvError } from "./parse-cv";
import type { ExtractedProfile } from "./schema";

export type ExtractProfileOptions = {
  /** Called once with the summed token usage (success or failure). */
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
  /** Override the configured LLM provider (tests). */
  provider?: LlmProvider;
};

export type ExtractProfileResult = {
  profile: ExtractedProfile;
  /** Number of values dropped by the grounding guard (invented by the model). */
  removedCount: number;
  promptVersion: string;
};

/** Throws CvError("llm_failed") when the model does not return a valid profile. */
export async function extractProfileFromText(
  cvText: string,
  opts: ExtractProfileOptions = {},
): Promise<ExtractProfileResult> {
  const { system, prompt } = buildExtractProfilePrompt(cvText);

  let data: ExtractedProfile;
  try {
    ({ data } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: opts.provider,
      onUsage: opts.onUsage,
    }));
  } catch (cause) {
    // Invalid JSON after the retry (LlmJsonError), provider/API outage or missing
    // LLM configuration: the student sees the same message; `cause` keeps the detail.
    throw new CvError("llm_failed", { cause });
  }

  const { profile, removed } = groundProfile(data, cvText);
  return { profile, removedCount: removed.length, promptVersion: PROMPT_VERSION };
}
