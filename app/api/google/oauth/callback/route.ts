import { NextResponse, type NextRequest } from "next/server";

import { logEvent } from "@/lib/events";
import { saveConnection } from "@/lib/google/connection";
import {
  GMAIL_DEFAULT_NEXT,
  hasRequiredScopes,
  OAUTH_NONCE_COOKIE,
  verifyOAuthState,
} from "@/lib/google/oauth";
import { exchangeCode, revokeToken } from "@/lib/integrations/gmail";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Reason codes shown by the Gmail card (`?gmail=error&reason=…`). */
type GmailCallbackReason =
  "access_denied" | "state" | "missing_code" | "exchange" | "scopes" | "save";

function finish(origin: string, next: string, result: "connected" | GmailCallbackReason) {
  const url = new URL(next, origin);
  if (result === "connected") {
    url.searchParams.set("gmail", "connected");
  } else {
    url.searchParams.set("gmail", "error");
    url.searchParams.set("reason", result);
  }
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  // One-shot nonce: always cleared.
  response.cookies.set(OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google/oauth",
    maxAge: 0,
  });
  return response;
}

/**
 * GET /api/google/oauth/callback — Google redirects here after consent.
 * Checks signed state + cookie nonce + session user, requires both Gmail
 * scopes, then stores the encrypted tokens. Never logs tokens or addresses.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", GMAIL_DEFAULT_NEXT);
    return NextResponse.redirect(login);
  }

  const verified = verifyOAuthState(
    searchParams.get("state") ?? "",
    request.cookies.get(OAUTH_NONCE_COOKIE)?.value,
    user.id,
  );
  const next = verified.ok ? verified.next : GMAIL_DEFAULT_NEXT;

  const googleError = searchParams.get("error");
  if (googleError) return finish(origin, next, "access_denied");
  if (!verified.ok) return finish(origin, next, "state");

  const code = searchParams.get("code");
  if (!code) return finish(origin, next, "missing_code");

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[gmail] code exchange failed", { name: err instanceof Error ? err.name : "" });
    return finish(origin, next, "exchange");
  }

  if (!hasRequiredScopes(tokens.scopes)) {
    // Do not keep a partial grant we cannot use.
    await revokeToken(tokens.refreshToken ?? tokens.accessToken);
    return finish(origin, next, "scopes");
  }

  try {
    await saveConnection(createAdminClient(), user.id, tokens);
  } catch (err) {
    console.error("[gmail] save connection failed", { name: err instanceof Error ? err.name : "" });
    return finish(origin, next, "save");
  }

  await logEvent(supabase, user.id, "gmail_connected");
  return finish(origin, next, "connected");
}
