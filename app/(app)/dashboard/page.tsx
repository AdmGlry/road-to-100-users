import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { latestSearchAction } from "@/app/(app)/hunter/actions";
import { hasNoExtractedData } from "@/components/profile/profile-utils";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadEditableProfile } from "@/lib/profile/service";
import { createClient } from "@/lib/supabase/server";

import { NextSteps, NextStepsSkeleton, type DashboardProgress } from "./next-steps";

export const metadata: Metadata = { title: "Tableau de bord · Spontané" };

export default function DashboardPage() {
  return (
    // The progress depends on the session (cookies): streamed behind Suspense.
    <Suspense fallback={<NextStepsSkeleton />}>
      <DashboardLoader />
    </Suspense>
  );
}

async function DashboardLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let progress: DashboardProgress | null = null;
  try {
    const supabase = await createClient();
    const [{ profile, hasCv }, latest] = await Promise.all([
      loadEditableProfile(supabase, user.id),
      latestSearchAction(),
    ]);
    const search = latest.ok ? latest.search : null;
    progress = {
      firstName: profile.full_name?.trim().split(/\s+/)[0] || null,
      profileDone: hasCv || !hasNoExtractedData(profile, user.email),
      rolesCount: profile.target_roles.length,
      leadsCount: search?.status === "done" ? search.results_count : null,
      searchRunning: search?.status === "running",
    };
  } catch {
    // Shown as a recoverable message; the steps stay usable as plain links.
    progress = null;
  }

  return <NextSteps progress={progress} />;
}
