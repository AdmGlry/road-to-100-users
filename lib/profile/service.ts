/**
 * Profile orchestration used by the server actions (app/(app)/profile).
 * SERVER ONLY. Every function takes the signed-in user's Supabase client, so
 * RLS and the `cvs` storage policies apply.
 * Never logs CV text or profile values.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";

import { extractProfileFromText } from "./extract";
import {
  editableToProfileUpdate,
  emptyEditableProfile,
  profileRowToEditable,
  type ProfileRow,
} from "./mapping";
import { CvError, extractCvText } from "./parse-cv";
import {
  CV_BUCKET,
  cvStoragePath,
  editableProfileSchema,
  type EditableProfile,
  type ExtractedProfile,
} from "./schema";

export { proposeCvChanges, applyCvChanges, type FieldChange } from "./merge";

const PROFILE_COLUMNS =
  "full_name, email, phone, city, school, degree, contract_type, rhythm, start_date, " +
  "target_roles, target_sectors, search_radius_km, skills, experiences, education, languages, " +
  "pitch, cv_storage_path, updated_at";

/**
 * Reads `cvs/{userId}/cv.pdf`, extracts its text and a grounded profile.
 * Stores cv_text + cv_storage_path on the profile row (the extracted fields are
 * NOT written: the UI pre-fills the form or proposes changes).
 * Throws CvError (not_found | not_pdf | too_large | too_short | llm_failed).
 */
export async function processStoredCv(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ cvText: string; extracted: ExtractedProfile; removedCount: number }> {
  const path = cvStoragePath(userId);
  const { data: blob, error: downloadError } = await supabase.storage
    .from(CV_BUCKET)
    .download(path);
  if (downloadError || !blob) throw new CvError("not_found", { cause: downloadError });

  const cvText = await extractCvText(new Uint8Array(await blob.arrayBuffer()));

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ cv_text: cvText, cv_storage_path: path })
    .eq("user_id", userId);
  if (updateError) {
    throw new Error(`profiles update failed (${updateError.code ?? "unknown"})`);
  }

  const { profile, removedCount, promptVersion } = await extractProfileFromText(cvText, {
    onUsage: (usage) =>
      logEvent(supabase, userId, "llm_usage", {
        prompt: usage.promptName,
        prompt_version: usage.promptVersion,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        attempts: usage.attempts,
        success: usage.success,
      }),
  });

  await logEvent(supabase, userId, "cv_uploaded", {
    chars: cvText.length,
    removed_count: removedCount,
    prompt_version: promptVersion,
  });

  return { cvText, extracted: profile, removedCount };
}

export async function loadEditableProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ profile: EditableProfile; hasCv: boolean; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles select failed (${error.code ?? "unknown"})`);
  if (!data) return { profile: emptyEditableProfile(), hasCv: false, updatedAt: null };

  const row = data as unknown as Record<string, unknown>;
  return {
    profile: profileRowToEditable(row as Partial<ProfileRow>),
    hasCv: typeof row.cv_storage_path === "string" && row.cv_storage_path.length > 0,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/**
 * Validates a partial profile (unknown keys rejected) and updates the row.
 * Throws a ZodError on invalid input, an Error on database failure.
 */
export async function saveProfilePatch(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<EditableProfile>,
): Promise<void> {
  const valid = editableProfileSchema.partial().strict().parse(patch);
  const update = editableToProfileUpdate(valid);
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
  if (error) throw new Error(`profiles update failed (${error.code ?? "unknown"})`);
}
