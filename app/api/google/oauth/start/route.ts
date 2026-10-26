import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { isGoogleConfigured } from "@/lib/env";
import {
  buildAuthUrl,
  createOAuthState,
  GMAIL_DEFAULT_NEXT,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/google/oauth/start?next=/hunter/review
 * Starts the Gmail OAuth flow (SPEC §6.1) for the signed-in student only.
 * The signed state carries the user id; its nonce is also stored in an
 * httpOnly cookie checked by the callback.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get("next"), GMAIL_DEFAULT_NEXT);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  if (!isGoogleConfigured()) {
    const back = new URL(next, origin);
    back.searchParams.set("gmail", "error");
    back.searchParams.set("reason", "not_configured");
    return NextResponse.redirect(back);
  }

  let url: string;
  let nonce: string;
  try {
    const created = createOAuthState(user.id, { next });
    nonce = created.nonce;
    url = buildAuthUrl(created.state);
  } catch (err) {
    console.error("[gmail] oauth start failed", { name: err instanceof Error ? err.name : "" });
    const back = new URL(next, origin);
    back.searchParams.set("gmail", "error");
    back.searchParams.set("reason", "not_configured");
    return NextResponse.redirect(back);
  }

  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google/oauth",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });
  return response;
}
