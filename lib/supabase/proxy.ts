import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "./config";

/**
 * Refreshes the Supabase session for this request (called from proxy.ts).
 *
 * Returns the `NextResponse.next()` to continue with (carrying any refreshed
 * auth cookies and no-cache headers) and the authenticated user, if any.
 * When redirecting instead, copy the auth state over with `withAuthState`.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  const { url, anonKey } = getPublicSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Forward refreshed cookies to the app (request) and to the browser (response).
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache-Control etc. so a CDN never serves one user's cookies to another.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getUser(): it triggers the refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/** Copies auth cookies and cache headers from `source` onto `target` (e.g. a redirect). */
export function withAuthState(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  }
  return target;
}
