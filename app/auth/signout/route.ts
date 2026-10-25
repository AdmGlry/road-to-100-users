import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Signs the user out (form POST from the app header) and goes back to the landing page. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // 303 so the browser follows the redirect with GET.
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
