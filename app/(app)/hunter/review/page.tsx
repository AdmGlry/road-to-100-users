import type { Metadata } from "next";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getReviewStateAction } from "@/app/(app)/hunter/review/actions";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Relecture et envoi · Spontané" };

/**
 * Route segment config: applies to every Server Action invoked from this
 * page. The preparation run (`after()` in continuePreparationAction, up to
 * 240 s), the send queue (50 s) and the regeneration (≈ 20–40 s) all fit
 * within 300 s, the Vercel ceiling (fluid compute).
 */
export const maxDuration = 300;

export default function ReviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-10 w-fit">
          <Link href="/hunter">
            <ArrowLeftIcon aria-hidden="true" />
            Retour au Chasseur
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Relecture et envoi</h1>
        <p className="text-muted-foreground max-w-prose">
          Relis chaque mail, corrige-le si besoin, puis valide-le. Rien ne part sans ta validation :
          tu confirmeras l&apos;envoi une dernière fois.
        </p>
      </div>
      {/* Depends on the session (cookies): streamed behind Suspense (Cache Components). */}
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewLoader />
      </Suspense>
    </div>
  );
}

async function ReviewLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const result = await getReviewStateAction();
  if (!result.ok) {
    return (
      <Card className="border-destructive/40" role="alert">
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">Impossible d&apos;afficher tes mails</h2>
          </CardTitle>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/hunter/review">Recharger la page</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <ReviewWorkspace initialState={result.state} />;
}

function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="sr-only" role="status">
        Chargement de tes mails…
      </p>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border p-4" aria-hidden="true">
          <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
          <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-24 w-full animate-pulse rounded" />
          <div className="bg-muted h-10 w-full animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
