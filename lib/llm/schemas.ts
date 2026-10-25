/**
 * Shared Zod schemas for LLM JSON outputs.
 *
 * Each prompt in lib/llm/prompts/ defines (or imports from here) the schema
 * its output must satisfy; generateJson() validates against it. Keep reusable
 * building blocks here; prompt-specific schemas live next to their prompt
 * unless shared by several prompts.
 */
import { z } from "zod";

/** A trimmed string that must not be empty. */
export const nonEmptyString = z.string().trim().min(1);
