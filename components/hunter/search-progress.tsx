"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  CircleIcon,
  LoaderCircleIcon,
  RotateCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSearchStatusAction, type SearchStatus } from "@/app/(app)/hunter/actions";
import {
  isStaleSearch,
  nextPollDelay,
  progressPercent,
  SEARCH_STEPS,
  stepLabel,
  stepStates,
} from "@/components/hunter/hunter-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STALE_MESSAGE =
  "La recherche n'a pas abouti (elle a pris trop de temps). Relance-la, ça arrive parfois quand le service est chargé.";

/**
 * Polls the search status every 1.5 s while it runs (10 s when the tab is
 * hidden, longer after network errors) and stops on done/failed/unmount.
 * Server Actions are dispatched one at a time per client, so a single
 * request is ever in flight.
 */
export function SearchProgress({
  searchId,
  initialStatus,
  onDone,
  onFailed,
  onEdit,
  onRetry,
  retrying = false,
}: {
  searchId: string;
  initialStatus?: SearchStatus | null;
  onDone: (status: SearchStatus) => void;
  /** Called once the search is known to have failed (lets the form be edited again). */
  onFailed?: () => void;
  /** Opens the criteria form (e.g. to fix a misspelled city). */
  onEdit?: () => void;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const [status, setStatus] = useState<SearchStatus | null>(initialStatus ?? null);
  const [failure, setFailure] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const onDoneRef = useRef(onDone);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onDoneRef.current = onDone;
    onFailedRef.current = onFailed;
  }, [onDone, onFailed]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let errors = 0;

    const schedule = () => {
      if (cancelled) return;
      const hidden = document.visibilityState === "hidden";
      timer = setTimeout(poll, nextPollDelay({ hidden, consecutiveErrors: errors }));
    };

    const poll = async () => {
      timer = null;
      if (cancelled) return;
      try {
        const result = await getSearchStatusAction(searchId);
        if (cancelled) return;
        if (!result.ok) {
          errors += 1;
          // Unknown search or expired session: no point in polling further.
          if (errors >= 3) {
            setFailure(result.message);
            onFailedRef.current?.();
            return;
          }
          schedule();
          return;
        }
        errors = 0;
        setOffline(false);
        setStatus(result.search);
        if (result.search.status === "done") {
          onDoneRef.current(result.search);
          return;
        }
        if (result.search.status === "failed") {
          onFailedRef.current?.();
          return;
        }
        if (isStaleSearch(result.search.created_at)) {
          setFailure(STALE_MESSAGE);
          onFailedRef.current?.();
          return;
        }
        schedule();
      } catch {
        if (cancelled) return;
        errors += 1;
        setOffline(true);
        schedule();
      }
    };

    // Coming back to the tab: poll right away instead of waiting the slow delay.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && timer) {
        clearTimeout(timer);
        timer = null;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [searchId]);

  const failed = failure !== null || status?.status === "failed";
  const errorMessage =
    failure ??
    (status?.status === "failed"
      ? status.error || "La recherche a échoué. Réessaie dans un instant."
      : null);

  const progress = status?.progress;
  const states = stepStates(status?.status === "done" ? "done" : progress?.step);
  const percent = status?.status === "done" ? 100 : progressPercent(progress);
  const currentLabel = stepLabel(status?.status === "done" ? "done" : progress?.step, progress);

  if (failed) {
    return (
      <Card className="border-destructive/40" role="alert">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircleIcon aria-hidden="true" className="text-destructive size-5" />
            <h2 className="text-lg">La recherche a échoué</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">{errorMessage}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onRetry} disabled={retrying} className="h-10 w-full sm:w-fit">
              {retrying ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <RotateCwIcon aria-hidden="true" />
              )}
              Réessayer
            </Button>
            {onEdit && (
              <Button variant="outline" onClick={onEdit} className="h-10 w-full sm:w-fit">
                Modifier les critères
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">Recherche en cours…</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label="Avancement de la recherche"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent} % – ${currentLabel}`}
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          {/* Announces step changes (not every percent) to screen readers. */}
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {currentLabel}…
          </p>
        </div>

        <ol className="flex flex-col gap-3">
          {SEARCH_STEPS.map((entry, i) => {
            const state = states[i];
            const label = entry.step === "scoring" ? stepLabel("scoring", progress) : entry.label;
            return (
              <li
                key={entry.step}
                className={cn(
                  "flex items-center gap-3 text-sm",
                  state === "pending" && "text-muted-foreground",
                  state === "current" && "font-medium",
                )}
              >
                {state === "done" ? (
                  <CheckIcon
                    aria-hidden="true"
                    className="size-4 text-emerald-700 dark:text-emerald-400"
                  />
                ) : state === "current" ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <CircleIcon aria-hidden="true" className="size-4" />
                )}
                <span>
                  {label}
                  <span className="sr-only">
                    {state === "done"
                      ? " : terminé"
                      : state === "current"
                        ? " : en cours"
                        : " : à venir"}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {offline && (
          <p className="text-muted-foreground text-xs">
            Connexion instable : on réessaie automatiquement…
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Tu peux quitter cette page : la recherche continue et tu retrouveras les résultats ici.
        </p>
      </CardContent>
    </Card>
  );
}
