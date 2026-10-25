import type { User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * The authenticated user for this request, or null. Verified against the
 * Supabase Auth server (getUser), deduplicated per request with React cache.
 * Reads cookies: render callers behind a <Suspense> boundary (Cache Components).
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
