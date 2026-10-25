import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { latestSearchAction, listLeadsAction, type Lead } from "@/app/(app)/hunter/actions";
import { HunterWorkspace } from "@/components/hunter/hunter-workspace";
import { LeadListSkeleton } from "@/components/hunter/lead-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { defaultParamsFromProfile } from "@/lib/hunter/types";
import { loadEditableProfile } from "@/lib/profile/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Chasseur · Spontané" };

/**
 * Route segment config (Next.js docs: `maxDuration`, "Server Actions": set at
 * the page level, it applies to every Server Action invoked from this page).
 * The search itself runs in `after()` inside startSearchAction, and `after`
 * runs within the route's maxDuration: NAF mapping + company fetch + LLM
 * scoring target < 60 s, 300 s is the Vercel ceiling (fluid compute, Hobby).
 */
export const maxDuration = 300;

export default function HunterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Chasseur</h1>
        <p className="text-muted-foreground">
          Trouve des entreprises qui n&apos;ont pas publié d&apos;offre, notées selon ton profil.
          Coche celles qui t&apos;intéressent.
        </p>
      </div>
      {/* Profile + latest search depend on the session (cookies): streamed behind Suspense. */}
      <Suspense fallback={<HunterSkeleton />}>
        <HunterLoader />
      </Suspense>
    </div>
  );
}

async function HunterLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ profile }, latestResult] = await Promise.all([
    loadEditableProfile(supabase, user.id),
    latestSearchAction(),
  ]);
  const latest = latestResult.ok ? latestResult.search : null;

  let initialLeads: Lead[] | null = null;
  let leadsError: string | null = null;
  if (latest?.status === "done") {
    const leads = await listLeadsAction(latest.id, {});
    if (leads.ok) initialLeads = leads.leads;
    else leadsError = leads.message;
  }

  const profileIncomplete = profile.target_roles.length === 0 || !profile.city?.trim();

  return (
    <div className="flex flex-col gap-6">
      {profileIncomplete && (
        <Card className="border-warning/40 bg-warning-soft">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base">Il manque tes postes visés ou ta ville</h2>
            </CardTitle>
            <CardDescription className="text-foreground/80">
              Ajoute-les à ton profil pour que chaque recherche parte de là. Tu peux aussi les
              saisir directement dans les critères ci-dessous.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="h-10">
              <Link href="/profile">Compléter mon profil</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {!latestResult.ok && (
        <p role="alert" className="text-destructive text-sm">
          {latestResult.message}
        </p>
      )}
      <HunterWorkspace
        initialParams={defaultParamsFromProfile(profile)}
        latest={latest}
        initialLeads={initialLeads}
        leadsError={leadsError}
      />
    </div>
  );
}

function HunterSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement du Chasseur…
      </p>
      <div className="bg-muted h-72 animate-pulse rounded-xl" aria-hidden="true" />
      <LeadListSkeleton count={2} />
    </div>
  );
}
