import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { refreshTrackerAction } from "@/app/(app)/tracker/actions";
import { TrackerWorkspace } from "@/components/tracker/tracker-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Suivi · Spontané" };

/**
 * Route segment config: applies to the Server Actions invoked from this
 * page. The manual sync runs inline with a 25 s budget and a follow-up send
 * takes a few seconds; 60 s leaves room for both.
 */
export const maxDuration = 60;

export default function TrackerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Suivi</h1>
        <p className="text-muted-foreground max-w-prose">
          Tes candidatures envoyées et les réponses reçues dans ton Gmail, classées pour toi. Ouvre
          une carte pour lire les réponses, valider une relance ou corriger son statut.
        </p>
      </div>
      {/* Depends on the session (cookies): streamed behind Suspense (Cache Components). */}
      <Suspense fallback={<TrackerSkeleton />}>
        <TrackerLoader />
      </Suspense>
    </div>
  );
}

async function TrackerLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const result = await refreshTrackerAction();
  if (!result.ok) {
    return (
      <Card className="border-destructive/40" role="alert">
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">Impossible d&apos;afficher ton suivi</h2>
          </CardTitle>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/tracker">Recharger la page</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  // Request time (after the session read): seeds the relative dates.
  return <TrackerWorkspace initialState={result.state} renderedAt={requestTime()} />;
}

/** Server clock at request time (the loader already read the session). */
function requestTime(): number {
  return Date.now();
}

function TrackerSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement de ton suivi…
      </p>
      <div className="bg-muted h-20 w-full animate-pulse rounded-xl" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className={i === 0 ? "flex flex-col gap-2" : "hidden flex-col gap-2 lg:flex"}
          >
            <div className="bg-muted h-24 animate-pulse rounded-xl" />
            <div className="bg-muted h-24 animate-pulse rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
