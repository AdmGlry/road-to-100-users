/**
 * Public Supabase settings (URL + anon key), safe for the browser.
 *
 * The NEXT_PUBLIC_* variables must be referenced literally so Next.js can
 * inline them into the client bundle.
 */
export function getPublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [
    !url?.trim() && "NEXT_PUBLIC_SUPABASE_URL",
    !anonKey?.trim() && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase environment variables: ${missing.join(", ")}. See .env.example.`,
    );
  }
  return { url: url!.trim(), anonKey: anonKey!.trim() };
}
