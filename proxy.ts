import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { updateSession, withAuthState } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = [
  "/onboarding",
  "/profile",
  "/hunter",
  "/tracker",
  "/settings",
  "/dashboard",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search, searchParams } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withAuthState(response, NextResponse.redirect(loginUrl));
  }

  if (user && pathname === "/login") {
    const target = safeRedirectPath(searchParams.get("next"));
    return withAuthState(response, NextResponse.redirect(new URL(target, request.url)));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, favicon, images and
    // the cron endpoints (authenticated with their own bearer secret).
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
