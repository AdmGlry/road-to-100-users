"use server";

/**
 * Server Actions of the settings screen. The user is always re-read from the
 * Supabase session; the service-role client is only used for
 * `google_connections` (no client policy), filtered on that verified id.
 */
import { logEvent } from "@/lib/events";
import { disconnectGmail } from "@/lib/google/connection";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DisconnectGmailResult = { ok: true } | { ok: false; message: string };

export async function disconnectGmailAction(): Promise<DisconnectGmailResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Ta session a expiré. Reconnecte-toi puis réessaie." };

  try {
    await disconnectGmail(createAdminClient(), user.id);
  } catch (err) {
    console.error("[gmail] disconnect failed", { name: err instanceof Error ? err.name : "" });
    return {
      ok: false,
      message: "La déconnexion de Gmail a échoué. Réessaie dans un instant.",
    };
  }
  await logEvent(supabase, user.id, "gmail_disconnected");
  return { ok: true };
}
