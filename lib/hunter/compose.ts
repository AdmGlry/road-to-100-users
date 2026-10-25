/**
 * Application mail composition (SPEC §7.5). SERVER ONLY.
 *
 * 1. prompt `compose_application` (smart tier);
 * 2. automatic checks (lib/hunter/claims.ts): claims_used grounded in the
 *    profile, 120–180 words, subject ≤ 70 characters, no hollow words, no
 *    figure absent from the profile / company facts;
 * 3. any problem → ONE regeneration with the problems listed;
 * 4. the best attempt is returned with what is still wrong in
 *    `claims_unverified` / `warnings` (shown to the student). Never silently
 *    accepted, never silently rewritten.
 * Throws only when no attempt produced a valid JSON mail (LlmJsonError or a
 * provider error); the caller turns it into a French message.
 */
import type {
  CompanyFacts,
  CompanyInsight,
  ComposedMail,
  ContactCandidate,
} from "@/lib/hunter/application-types";
import { generateJson, type LlmProvider, type LlmUsageEvent } from "@/lib/llm/client";
import {
  buildComposeApplicationPrompt,
  MAX_TOKENS,
  MODEL_TIER,
  outputSchema,
  PROMPT_NAME,
  PROMPT_VERSION,
  type ComposeApplicationOutput,
} from "@/lib/llm/prompts/compose-application";
import type { EditableProfile } from "@/lib/profile/schema";

import { analyzeMail, type MailProblem } from "./claims";

export { PROMPT_VERSION as COMPOSE_PROMPT_VERSION };

export type ComposeDeps = {
  provider?: LlmProvider;
  onUsage?: (event: LlmUsageEvent) => void | Promise<void>;
};

export type ComposeInput = {
  profile: EditableProfile;
  company: CompanyFacts;
  contact: ContactCandidate | null;
  insight: CompanyInsight;
};

/** Facts other than the profile that the mail may quote (numbers included). */
function allowedText(input: ComposeInput): string {
  const c = input.company;
  return [c.name, c.city, c.naf_label, c.headcount_label, input.insight.text]
    .filter(Boolean)
    .join(" ");
}

/** Lower = better: unverified claims weigh most, then other problems. */
function badness(problems: MailProblem[]): number {
  return problems.reduce(
    (sum, p) =>
      sum +
      (p.code === "claims_unverified"
        ? 10 * p.claims.length
        : p.code === "unknown_numbers"
          ? 10
          : p.code === "claims_missing"
            ? 5
            : 1),
    0,
  );
}

export async function composeApplication(
  input: ComposeInput,
  deps: ComposeDeps = {},
): Promise<ComposedMail> {
  const context = { allowedText: allowedText(input) };
  const generate = async (problems?: string[]): Promise<ComposeApplicationOutput> => {
    const { system, prompt } = buildComposeApplicationPrompt({
      profile: input.profile,
      company: {
        name: input.company.name,
        activity: input.company.naf_label,
        city: input.company.city,
        size: input.company.headcount_label,
      },
      contact: input.contact
        ? {
            first_name: input.contact.first_name,
            last_name: input.contact.last_name,
            role: input.contact.role,
          }
        : null,
      insight: input.insight,
      problems,
    });
    const { data } = await generateJson({
      system,
      prompt,
      schema: outputSchema,
      tier: MODEL_TIER,
      maxTokens: MAX_TOKENS,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      provider: deps.provider,
      onUsage: deps.onUsage,
    });
    return data;
  };

  const first = await generate();
  let best = { mail: first, problems: analyzeMail(first, input.profile, context) };

  if (best.problems.length > 0) {
    try {
      const second = await generate(best.problems.map((p) => p.message));
      const problems = analyzeMail(second, input.profile, context);
      if (badness(problems) <= badness(best.problems)) best = { mail: second, problems };
    } catch (e) {
      // Keep the first attempt, flagged.
      console.warn(`[compose] regeneration failed (${e instanceof Error ? e.name : "unknown"})`);
    }
  }

  const unverified = best.problems.flatMap((p) => (p.code === "claims_unverified" ? p.claims : []));
  return {
    subject: best.mail.subject,
    body: best.mail.body,
    claims_used: best.mail.claims_used,
    claims_unverified: unverified,
    warnings: best.problems.filter((p) => p.code !== "claims_unverified").map((p) => p.message),
    prompt_version: PROMPT_VERSION,
  };
}
