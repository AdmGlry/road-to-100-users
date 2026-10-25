import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadEditableProfile } from "@/lib/profile/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profil · Spontané" };

/**
 * Applies to the Server Actions invoked from this page too (Next.js docs:
 * route segment config `maxDuration`): the CV analysis (PDF text + LLM)
 * targets < 20 s, 60 s leaves headroom on Vercel.
 */
export const maxDuration = 60;

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Mon profil</h1>
        <p className="text-muted-foreground">
          Ces informations servent à trouver des entreprises et à rédiger tes candidatures.
        </p>
      </div>
      {/* The profile depends on the session (cookies): it streams in behind Suspense. */}
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileLoader />
      </Suspense>
    </div>
  );
}

async function ProfileLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { profile, hasCv, updatedAt } = await loadEditableProfile(supabase, user.id);

  return (
    <ProfileWorkspace
      userId={user.id}
      initialProfile={profile}
      hasCv={hasCv}
      updatedAt={updatedAt}
    />
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement du profil…
      </p>
      {[40, 64, 64].map((h, i) => (
        <div
          key={i}
          className="bg-muted animate-pulse rounded-xl"
          style={{ height: `${h * 4}px` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
