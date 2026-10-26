"use client";

import { SquareKanbanIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshTrackerAction, syncNowAction } from "@/app/(app)/tracker/actions";
import { GmailConnectCard } from "@/components/gmail/gmail-connect-card";
import { GmailStatusBanner } from "@/components/gmail/gmail-status-banner";
import { CardDetailDialog } from "@/components/tracker/card-detail-dialog";
import { StatsBand } from "@/components/tracker/stats-band";
import { TrackerBoard } from "@/components/tracker/tracker-board";
import { cardTriggerId } from "@/components/tracker/tracker-card";
import { fullDate, lastSyncLabel, syncAnnouncement } from "@/components/tracker/tracker-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrackerColumn, TrackerState } from "@/lib/tracker/types";

const TRACKER_PATH = "/tracker";
/** Refresh when the student comes back to the tab after this long. */
const STALE_MS = 60_000;
/** Poll while a follow-up is being sent. */
const SENDING_POLL_MS = 10_000;

/**
 * Client side of /tracker: stats, Gmail status, manual sync, the Kanban and
 * the detail dialog. `renderedAt` (server time of the render) seeds the clock
 * used for relative dates, so the server and the browser print the same text.
 */
export function TrackerWorkspace({
  initialState,
  renderedAt,
}: {
  initialState: TrackerState;
  renderedAt: number;
}) {
  const [state, setState] = useState<TrackerState>(initialState);
  const [now, setNow] = useState(renderedAt);
  const [active, setActive] = useState<TrackerColumn>("sent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastLoad = useRef(renderedAt);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = useCallback((next: TrackerState) => {
    lastLoad.current = Date.now();
    setState(next);
  }, []);

  // Relative dates tick every minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await refreshTrackerAction();
      if (result.ok) applyState(result.state);
    } catch {
      // Offline: keep what is shown, the next refresh will catch up.
    }
  }, [applyState]);

  // Back on the tab after a while: reload the board.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (Date.now() - lastLoad.current > STALE_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  const sendingFollowup = state.cards.some((c) => c.followup?.status === "sending");
  useEffect(() => {
    if (!sendingFollowup) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, SENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [sendingFollowup, refresh]);

  const openCard = state.cards.find((c) => c.applicationId === openId) ?? null;

  const closeDetail = () => {
    const id = openId;
    setOpenId(null);
    if (!id) return;
    // The card may have moved column: show its tab before restoring the focus.
    const card = stateRef.current.cards.find((c) => c.applicationId === id);
    if (card) setActive(card.column);
    requestAnimationFrame(() => document.getElementById(cardTriggerId(id))?.focus());
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    setAnnouncement("Synchronisation en cours…");
    try {
      const result = await syncNowAction();
      if (!result.ok) {
        setSyncError(result.message);
        setAnnouncement("");
        return;
      }
      applyState(result.state);
      setNow(Date.now());
      setAnnouncement(syncAnnouncement(result.newReplies));
    } catch {
      setSyncError("Connexion perdue : la synchronisation n'a pas pu être lancée. Réessaie.");
      setAnnouncement("");
    } finally {
      setSyncing(false);
    }
  };

  const gmail = state.gmail;
  const gmailReady = gmail.state === "active" && !gmail.missingScopes;
  const gmailBroken = gmail.missingScopes || gmail.state === "expired" || gmail.state === "revoked";
  const empty = state.cards.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {!gmailReady &&
        (gmailBroken ? (
          <GmailStatusBanner status={gmail} next={TRACKER_PATH} />
        ) : (
          <GmailConnectCard status={gmail} next={TRACKER_PATH} />
        ))}

      {empty ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SquareKanbanIcon aria-hidden="true" className="text-muted-foreground size-5" />
              <h2 className="text-lg">Aucune candidature envoyée pour l&apos;instant</h2>
            </CardTitle>
            <CardDescription>
              Dès que tes premiers mails partent, ils apparaissent ici. Les réponses reçues dans ton
              Gmail sont classées automatiquement, et une relance t&apos;est proposée au bout
              d&apos;une semaine sans réponse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-fit">
              <Link href="/hunter">Trouver des entreprises</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatsBand stats={state.stats} />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p
              className="text-muted-foreground text-sm"
              title={fullDate(state.lastSyncAt) ?? undefined}
            >
              {lastSyncLabel(state.lastSyncAt, now)}
              {gmailReady && ". Synchronisation automatique toutes les heures."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void syncNow()}
              disabled={syncing || !gmailReady}
            >
              {syncing ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCwIcon aria-hidden="true" />
              )}
              {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
            </Button>
          </div>
          {syncError && (
            <p role="alert" className="text-destructive -mt-3 text-sm sm:text-right">
              {syncError}
            </p>
          )}

          <TrackerBoard
            cards={state.cards}
            now={now}
            active={active}
            onActiveChange={setActive}
            onOpen={setOpenId}
          />
        </>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {openCard && (
        <CardDetailDialog
          key={openCard.applicationId}
          card={openCard}
          gmail={gmail}
          now={now}
          onClose={closeDetail}
          onState={applyState}
          onAnnounce={setAnnouncement}
        />
      )}
    </div>
  );
}
