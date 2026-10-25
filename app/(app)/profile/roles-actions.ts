"use server";

/**
 * Server Actions of the "Métiers suggérés" card (coach d'orientation,
 * Sprint 1.5).
 *
 * Like app/(app)/profile/actions.ts: every action re-reads the signed-in
 * user from the Supabase session (never a user id from the client), the
 * Supabase client acts as that user (RLS), and no profile value or model
 * output is ever logged.
 */
import { z } from "zod";

import { loadEditableProfile, saveProfilePatch } from "@/lib/profile/service";
import { RoleSuggestionError, suggestRoles } from "@/lib/profile/roles";
import {
  MAX_SECTORS_PER_ROLE,
  MAX_TARGET_LENGTH,
  MAX_TARGETS,
  mergeTargets,
  type RoleSuggestions,
} from "@/lib/profile/roles-schema";
import type { EditableProfile } from "@/lib/profile/schema";
import { createClient } from "@/lib/supabase/server";

const SESSION_EXPIRED = "Ta session a expiré. Reconnecte-toi puis réessaie.";
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const INVALID_DATA = "Ce métier n'a pas pu être ajouté. Réessaie.";

export type SuggestRolesActionResult =
  { ok: true; suggestions: RoleSuggestions } | { ok: false; message: string };

export type AddTargetRoleActionResult =
  | {
      ok: true;
      targetRoles: string[];
      targetSectors: string[];
      /** Whole profile after the change, so the form can be re-mounted with it. */
      profile: EditableProfile;
      savedAt: string;
    }
  | { ok: false; message: string };

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

/** Logs an unexpected failure without its message (it could quote profile data). */
function logFailure(action: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`[roles] ${action} failed`, {
    name: err instanceof Error ? err.name : typeof err,
    code,
  });
}

/**
 * Asks the coach for role suggestions. `answers` maps each question TEXT to
 * the option the student chose (all answers given so far).
 */
export async function suggestRolesAction(
  answers?: Record<string, string>,
): Promise<SuggestRolesActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const { supabase, user } = session;

  try {
    const suggestions = await suggestRoles(supabase, user.id, answers);
    return { ok: true, suggestions };
  } catch (err) {
    if (err instanceof RoleSuggestionError) {
      if (err.code === "llm_failed") logFailure("suggestRoles", err.cause);
      return { ok: false, message: err.userMessage };
    }
    logFailure("suggestRoles", err);
    return { ok: false, message: GENERIC_ERROR };
  }
}

const addTargetInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TARGET_LENGTH * 2),
  sectors: z.array(z.string().max(MAX_TARGET_LENGTH * 2)).max(MAX_SECTORS_PER_ROLE * 2),
});

/**
 * Adds a suggested role to target_roles and its sectors to target_sectors
 * (deduplicated, max 30 each). The current lists are re-read from the
 * database, never trusted from the client.
 */
export async function addTargetRoleAction(
  title: string,
  sectors: string[],
): Promise<AddTargetRoleActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  const { supabase, user } = session;

  const input = addTargetInput.safeParse({ title, sectors });
  if (!input.success) return { ok: false, message: INVALID_DATA };

  try {
    const { profile } = await loadEditableProfile(supabase, user.id);
    const merged = mergeTargets(
      profile.target_roles,
      profile.target_sectors,
      input.data.title,
      input.data.sectors,
    );
    if (merged.roleListFull) {
      return {
        ok: false,
        message: `Tu as déjà ${MAX_TARGETS} métiers visés : retires-en un dans ton profil pour en ajouter un autre.`,
      };
    }
    const next: EditableProfile = {
      ...profile,
      target_roles: merged.targetRoles,
      target_sectors: merged.targetSectors,
    };
    if (merged.changed) {
      await saveProfilePatch(supabase, user.id, {
        target_roles: merged.targetRoles,
        target_sectors: merged.targetSectors,
      });
    }
    return {
      ok: true,
      targetRoles: merged.targetRoles,
      targetSectors: merged.targetSectors,
      profile: next,
      savedAt: new Date().toISOString(),
    };
  } catch (err) {
    logFailure("addTargetRole", err);
    return { ok: false, message: GENERIC_ERROR };
  }
}
