"use client";

import { AlertCircleIcon, ChevronDownIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  listLeadsAction,
  startSearchAction,
  type LatestSearch,
  type Lead,
} from "@/app/(app)/hunter/actions";
import { LeadList, LeadListSkeleton } from "@/components/hunter/lead-list";
import { SearchForm } from "@/components/hunter/search-form";
import { SearchProgress } from "@/components/hunter/search-progress";
import { CONTRACT_TYPE_LABELS } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HunterSearchParams } from "@/lib/hunter/types";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; searchId: string }
  | { kind: "failed"; searchId: string }
  | { kind: "loadingLeads"; searchId: string }
  | { kind: "results"; searchId: string; leads: Lead[] }
  | { kind: "leadsError"; searchId: string; message: string };

function initialPhase(
  latest: LatestSearch | null,
  initialLeads: Lead[] | null,
  leadsError: string | null,
): Phase {
  if (!latest) return { kind: "idle" };
  if (latest.status === "done" && initialLeads) {
    return { kind: "results", searchId: latest.id, leads: initialLeads };
  }
  if (latest.status === "done") {
    return {
      kind: "leadsError",
      searchId: latest.id,
      message: leadsError ?? "Impossible de charger les entreprises. Réessaie.",
    };
  }
  // running or failed: SearchProgress polls once and shows progress or the error.
  return { kind: "running", searchId: latest.id };
}

/**
 * Client side of /hunter: search criteria → progress (polling) → results.
 * A reload resumes the latest search (running or done) from the server.
 */
export function HunterWorkspace({
  initialParams,
  latest,
  initialLeads,
  leadsError = null,
}: {
  initialParams: HunterSearchParams;
  latest: LatestSearch | null;
  initialLeads: Lead[] | null;
  leadsError?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>(() => initialPhase(latest, initialLeads, leadsError));
  const [attempt, setAttempt] = useState(0);
  const [formOpen, setFormOpen] = useState(latest === null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [formParams] = useState<HunterSearchParams>(latest?.params ?? initialParams);
  const lastParams = useRef<HunterSearchParams>(formParams);
  // Criteria of the displayed search, summarized in the collapsed bar.
  const [summary, setSummary] = useState<HunterSearchParams>(formParams);
  const formCardRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const formRegionId = `${uid}-form`;

  const loadLeads = async (searchId: string) => {
    setPhase({ kind: "loadingLeads", searchId });
    try {
      const result = await listLeadsAction(searchId, {});
      setPhase(
        result.ok
          ? { kind: "results", searchId, leads: result.leads }
          : { kind: "leadsError", searchId, message: result.message },
      );
    } catch {
      setPhase({
        kind: "leadsError",
        searchId,
        message: "Connexion perdue : impossible de charger les entreprises.",
      });
    }
  };

  const start = async (params: HunterSearchParams) => {
    lastParams.current = params;
    setStarting(true);
    setStartError(null);
    try {
      const result = await startSearchAction(params);
      if (!result.ok) {
        setStartError(result.message);
        return;
      }
      setFormOpen(false);
      setSummary(params);
      setAttempt((a) => a + 1);
      setPhase({ kind: "running", searchId: result.searchId });
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }),
      );
    } catch {
      setStartError("Connexion perdue : la recherche n'a pas pu être lancée. Réessaie.");
    } finally {
      setStarting(false);
    }
  };

  const openForm = () => {
    setFormOpen(true);
    requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      formCardRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  };

  const running = phase.kind === "running";
  const hasSearch = phase.kind !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <Card ref={formCardRef} className={cn("scroll-mt-4 gap-4", hasSearch && !formOpen && "py-4")}>
        <CardHeader>
          {hasSearch ? (
            <button
              type="button"
              onClick={() => (formOpen ? setFormOpen(false) : openForm())}
              aria-expanded={formOpen}
              aria-controls={formRegionId}
              className="-m-2 flex min-h-10 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-md p-2 text-left"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <CardTitle>
                  <h2 className="text-lg">Critères de recherche</h2>
                </CardTitle>
                {/* Collapsed summary: 2 lines max, the full criteria are one tap away. */}
                <CardDescription
                  className={cn("wrap-anywhere", !formOpen && "line-clamp-2")}
                  title={formOpen ? undefined : summarizeParams(summary)}
                >
                  {formOpen ? "Modifie tes critères puis relance." : summarizeParams(summary)}
                </CardDescription>
              </span>
              <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm">
                <span className="hidden sm:inline">{formOpen ? "Fermer" : "Modifier"}</span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-5 transition-[rotate] duration-(--duration-base) ease-(--ease-out)",
                    formOpen && "rotate-180",
                  )}
                />
              </span>
            </button>
          ) : (
            <>
              <CardTitle>
                <h2 className="text-lg">Critères de recherche</h2>
              </CardTitle>
              <CardDescription>
                Pré-remplis avec ton profil. Modifie-les librement : ton profil ne change pas.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent
          id={formRegionId}
          hidden={!formOpen}
          // Reopening the collapsed criteria fades them in (not on first visit).
          className={cn("flex flex-col gap-4", hasSearch && "motion-enter")}
        >
          <SearchForm
            initialParams={formParams}
            onSubmit={(params) => void start(params)}
            busy={starting}
            disabled={running}
            submitLabel={hasSearch ? "Relancer la recherche" : "Lancer la recherche"}
          />
          {running && (
            <p className="text-muted-foreground text-sm">
              Une recherche est déjà en cours. Tu pourras en lancer une autre dès qu&apos;elle sera
              terminée.
            </p>
          )}
          {startError && (
            <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
              <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {startError}
            </p>
          )}
        </CardContent>
      </Card>

      <div ref={resultsRef} className="flex scroll-mt-4 flex-col gap-6">
        {(phase.kind === "running" || phase.kind === "failed") && (
          <SearchProgress
            key={`${phase.searchId}-${attempt}`}
            searchId={phase.searchId}
            onDone={() => void loadLeads(phase.searchId)}
            onFailed={() => setPhase({ kind: "failed", searchId: phase.searchId })}
            onEdit={openForm}
            onRetry={() => void start(lastParams.current)}
            retrying={starting}
          />
        )}
        {phase.kind === "failed" && startError && !formOpen && (
          <p role="alert" className="text-destructive text-sm">
            {startError}
          </p>
        )}
        {phase.kind === "loadingLeads" && <LeadListSkeleton />}
        {phase.kind === "leadsError" && (
          <Card className="border-destructive/40" role="alert">
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">Impossible d&apos;afficher les résultats</h2>
              </CardTitle>
              <CardDescription>{phase.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => void loadLeads(phase.searchId)}
              >
                Recharger les résultats
              </Button>
            </CardContent>
          </Card>
        )}
        {phase.kind === "results" && (
          <LeadList
            key={phase.searchId}
            searchId={phase.searchId}
            initialLeads={phase.leads}
            onEditSearch={openForm}
          />
        )}
      </div>
    </div>
  );
}

/** Programmatic scrolls jump instead of gliding when the user asked for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** "Business Analyst, Chef de projet · Nantes · 30 km · Alternance" */
function summarizeParams(p: HunterSearchParams): string {
  const what = [...p.roles, ...p.sectors].slice(0, 3).join(", ");
  const contract = p.contract_type ? CONTRACT_TYPE_LABELS[p.contract_type] : null;
  return [what, p.city, `${p.radius_km} km`, contract].filter(Boolean).join(" · ");
}
