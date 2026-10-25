"use server";

/**
 * Server Actions of the profile screen (SPEC §5).
 *
 * Every action re-reads the signed-in user from the Supabase session
 * (cookies): a user id is never accepted from the client. The Supabase
 * client acts as that user, so RLS applies to every read and write.
 * CV content and profile values are never logged.
 */
import { z } from "zod";

import { extractedToPatch, hasNoExtractedData } from "@/components/profile/profile-utils";
import { CvError } from "@/lib/profile/parse-cv";
import {
  EXTRACTED_FIELDS,
  editableProfileSchema,
  extractedProfileSchema,
  type EditableProfile,
} from "@/lib/profile/schema";
import {
  applyCvChanges,
  loadEditableProfile,
  processStoredCv,
  proposeCvChanges,
  saveProfilePatch,
  type FieldChange,
} from "@/lib/profile/service";
import { createClient } from "@/lib/supabase/server";

const SESSION_EXPIRED = "Ta session a expiré. Reconnecte-toi puis réessaie.";
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const INVALID_DATA = "Certaines informations ne sont pas valides. Vérifie le formulaire.";

export type AnalyzeCvResult =
  | { status: "applied"; profile: EditableProfile; savedAt: string }
  | { status: "review"; changes: FieldChange[] }
  | { status: "error"; message: string };

export type ApplyCvChangesResult =
  { ok: true; profile: EditableProfile; savedAt: string } | { ok: false; message: string };

export type SaveProfileResult = { ok: true; savedAt: string } | { ok: false; message: string };

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

/** Logs an unexpected failure without its message (it could quote CV or profile data). */
function logFailure(action: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`[profile] ${action} failed`, {
    name: err instanceof Error ? err.name : typeof err,
    code,
  });
}

/**
 * Reads the CV the browser just uploaded to Storage, extracts a profile
 * with the LLM and either fills an empty profile directly or returns the
 * proposed changes for review (CV replacement), without writing.
 */
export async function analyzeCv(): Promise<AnalyzeCvResult> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };
  const { supabase, user } = session;

  try {
    const { profile: current } = await loadEditableProfile(supabase, user.id);
    const { extracted } = await processStoredCv(supabase, user.id);

    if (hasNoExtractedData(current, user.email)) {
      const patch = extractedToPatch(extracted);
      await saveProfilePatch(supabase, user.id, patch);
      return {
        status: "applied",
        profile: { ...current, ...patch },
        savedAt: new Date().toISOString(),
      };
    }

    return { status: "review", changes: proposeCvChanges(current, extracted) };
  } catch (err) {
    if (err instanceof CvError) return { status: "error", message: err.userMessage };
    logFailure("analyzeCv", err);
    return {
      status: "error",
      message: "Impossible de lire ton CV pour le moment. Réessaie dans un instant.",
    };
  }
}

const fieldChangeSchema = z.object({
  field: extractedProfileSchema.keyof(),
  label: z.string(),
  current: z.unknown(),
  proposed: z.unknown(),
  defaultAccept: z.boolean(),
});

/**
 * Applies the CV changes the student ticked. The current profile is
 * re-read from the database (not trusted from the client) and only the
 * accepted fields are written.
 */
export async function applyCvChangesAction(
  changes: FieldChange[],
  acceptedFields: string[],
): Promise<ApplyCvChangesResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const { supabase, user } = session;

  const parsedChanges = z.array(fieldChangeSchema).max(EXTRACTED_FIELDS.length).safeParse(changes);
  const parsedAccepted = z.array(z.string()).max(EXTRACTED_FIELDS.length).safeParse(acceptedFields);
  if (!parsedChanges.success || !parsedAccepted.success) {
    return { ok: false, message: INVALID_DATA };
  }
  // Each proposed value must have the shape of its field.
  for (const change of parsedChanges.data) {
    const fieldSchema = extractedProfileSchema.shape[change.field];
    if (!fieldSchema.safeParse(change.proposed).success)
      return { ok: false, message: INVALID_DATA };
  }
  const accepted = parsedAccepted.data.filter((field) =>
    parsedChanges.data.some((change) => change.field === field),
  );

  try {
    const { profile: current } = await loadEditableProfile(supabase, user.id);
    if (accepted.length === 0) {
      return { ok: true, profile: current, savedAt: new Date().toISOString() };
    }
    const validChanges: FieldChange[] = parsedChanges.data.map((c) => ({
      ...c,
      current: c.current,
      proposed: c.proposed,
    }));
    const next = applyCvChanges(current, validChanges, accepted);
    const picked = Object.fromEntries(
      accepted.map((field) => [field, next[field as keyof EditableProfile]]),
    );
    const patch = editableProfileSchema.partial().strict().safeParse(picked);
    if (!patch.success) return { ok: false, message: INVALID_DATA };

    await saveProfilePatch(supabase, user.id, patch.data);
    return { ok: true, profile: { ...current, ...patch.data }, savedAt: new Date().toISOString() };
  } catch (err) {
    logFailure("applyCvChanges", err);
    return { ok: false, message: GENERIC_ERROR };
  }
}

/** Autosave: validates and writes the changed fields only. */
export async function saveProfileAction(
  patch: Partial<EditableProfile>,
): Promise<SaveProfileResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const { supabase, user } = session;

  const parsed = editableProfileSchema.partial().strict().safeParse(patch);
  if (!parsed.success) return { ok: false, message: INVALID_DATA };
  if (Object.keys(parsed.data).length === 0) {
    return { ok: true, savedAt: new Date().toISOString() };
  }

  try {
    await saveProfilePatch(supabase, user.id, parsed.data);
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (err) {
    logFailure("saveProfile", err);
    return { ok: false, message: "L'enregistrement a échoué. Vérifie ta connexion puis réessaie." };
  }
}
