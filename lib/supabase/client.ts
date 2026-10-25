import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "./config";

/** Supabase client for Client Components (session stored in cookies). */
export function createClient() {
  const { url, anonKey } = getPublicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
