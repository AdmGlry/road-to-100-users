/**
 * Service-role Supabase client: BYPASSES Row Level Security.
 *
 * SERVER ONLY (cron jobs, trusted route handlers). Never import this module
 * from a Client Component or from code shared with the browser.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "./config";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("lib/supabase/admin must never be used in the browser.");
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY: the admin Supabase client requires the service-role key (server only). See .env.example.",
    );
  }
  const { url } = getPublicSupabaseConfig();

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
