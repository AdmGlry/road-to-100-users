/**
 * Simple product analytics (`events` table, SPEC §4).
 *
 * Analytics must never break the user flow: every error is swallowed.
 * Props must NEVER contain CV text, mail contents, tokens or other personal
 * data — only counts, identifiers of prompts/models and similar metadata.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EventProps = Record<string, string | number | boolean | null>;

export async function logEvent(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  props: EventProps = {},
): Promise<void> {
  try {
    const { error } = await supabase.from("events").insert({ user_id: userId, name, props });
    if (error) console.warn(`[events] insert failed for "${name}" (${error.code ?? "unknown"})`);
  } catch {
    console.warn(`[events] insert threw for "${name}"`);
  }
}
