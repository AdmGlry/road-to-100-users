"use client";

import { MailIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  continuePreparationAction,
  processMyQueueAction,
  sendApprovedAction,
} from "@/app/(app)/hunter/review/actions";
import { GmailConnectCard } from "@/components/gmail/gmail-connect-card";
import { GmailStatusBanner } from "@/components/gmail/gmail-status-banner";
import { MailCard } from "@/components/review/mail-card";
import { PreparationProgress } from "@/components/review/preparation-progress";
import {
  activePreparations,
  countItems,
  countsSummary,
  pollPlan,
  quotaLabel,
  sendableItems,
} from "@/components/review/review-utils";
import { SendBar } from "@/components/review/send-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewState } from "@/lib/hunter/application-types";

const REVIEW_PATH = "/hunter/review";

/**
 * Client side of /hunter/review: preparation progress, the list of mails,
 * Gmail connection and the send bar. Polls the server while mails are being
 * prepared (5 s) or queued for sending (20 s); paused while the tab is hidden.
 */
export function ReviewWorkspace({ initialState }: { initialState: ReviewState }) {
  const [state, setState] = useState<ReviewState>(initialState);
  const [offline, setOffline] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Mails with open, unsaved edits: never sent in their stored (older) version.
  const [unsavedIds, setUnsavedIds] = useState<ReadonlySet<string>>(new Set());
  const onUnsavedChange = useCallback((id: string, unsaved: boolean) => {
    setUnsavedIds((prev) => {
      if (prev.has(id) === unsaved) return prev;
      const next = new Set(prev);
      if (unsaved) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = (next: ReviewState | null) => {
    if (next) setState(next);
  };

  const planKind = pollPlan(state)?.kind ?? null;

  useEffect(() => {
    if (!planKind) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let errors = 0;

    const schedule = (delayOverride?: number) => {
      if (cancelled || timer || document.visibilityState === "hidden") return;
      const plan = pollPlan(stateRef.current, errors);
      if (!plan) return;
      timer = setTimeout(poll, delayOverride ?? plan.delay);
    };

    const poll = async () => {
      timer = null;
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result =
          planKind === "prepare" ? await continuePreparationAction() : await processMyQueueAction();
        if (cancelled) return;
        if (result.ok) {
          errors = 0;
          setOffline(false);
          setPollError(null);
          setState(result.state);
        } else {
          errors += 1;
          if (errors >= 3) setPollError(result.message);
        }
      } catch {
        if (cancelled) return;
        errors += 1;
        setOffline(true);
      } finally {
        inFlight = false;
      }
      schedule();
    };

    // Hidden tab: no polling at all. Back on the tab: poll right away.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        timer = null;
        void poll();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Preparation: kick a possibly stopped run immediately; queue: wait.
    schedule(planKind === "prepare" ? 0 : undefined);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [planKind]);

  const validated = sendableItems(state.items);
  const sendable = validated.filter((i) => !unsavedIds.has(i.applicationId));
  const counts = countItems(state.items);
  const gmail = state.gmail;
  const gmailReady = gmail.state === "active" && !gmail.missingScopes;
  const gmailBroken =
    !gmail.missingScopes && (gmail.state === "expired" || gmail.state === "revoked");
  const hasItems = state.items.length > 0;
  const preparingCount = activePreparations(state);
  const nothingAtAll = !hasItems && state.preparing.length === 0;

  const confirmSend = async (ids: string[]): Promise<boolean> => {
    setSending(true);
    setSendError(null);
    try {
      const result = await sendApprovedAction(ids);
      if (!result.ok) {
        setSendError(result.message);
        return false;
      }
      applyState(result.state);
      const parts: string[] = [];
      if (result.queued > 0) {
        parts.push(
          result.queued > 1
            ? `${result.queued} mails en file d'attente. Le premier part dans la minute.`
            : "Ton mail est en file d'attente. Il part dans la minute.",
        );
      } else {
        parts.push("Aucun mail n'a été mis en file d'envoi.");
      }
      if (result.overQuota > 0) {
        parts.push(
          `${result.overQuota} mail${result.overQuota > 1 ? "s restent validés" : " reste validé"} : ton quota de 24 h est atteint.`,
        );
      }
      setAnnouncement(parts.join(" "));
      return true;
    } catch {
      setSendError("Connexion perdue : rien n'est parti. Réessaie.");
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    // group/review: the send bar hides itself while a text field is focused on touch screens.
    <div className="group/review flex flex-col gap-6">
      <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
        {countsSummary(counts)}
        {preparingCount > 0 && `, ${preparingCount} en préparation`}. {quotaLabel(state.quota)}.
      </p>

      {pollError && (
        <p role="alert" className="text-destructive text-sm">
          {pollError}
        </p>
      )}

      <PreparationProgress
        state={state}
        offline={offline}
        onState={applyState}
        onAnnounce={setAnnouncement}
      />

      {!gmailReady &&
        (gmailBroken ? (
          <GmailStatusBanner status={gmail} next={REVIEW_PATH} />
        ) : (
          <GmailConnectCard status={gmail} next={REVIEW_PATH} />
        ))}

      {nothingAtAll ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailIcon aria-hidden="true" className="text-muted-foreground size-5" />
              <h2 className="text-lg">Aucun mail à relire pour le moment</h2>
            </CardTitle>
            <CardDescription>
              Sélectionne des entreprises dans le Chasseur puis clique sur « Préparer N candidatures
              » : on trouve le bon contact et on rédige un mail pour chacune.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-fit">
              <Link href="/hunter">Choisir des entreprises</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        hasItems && (
          <section aria-labelledby="review-list-heading" className="flex flex-col gap-4">
            <h2 id="review-list-heading" className="text-xl font-semibold tracking-tight">
              Tes mails
            </h2>
            <ul
              aria-label="Mails à relire"
              // Keyboard focus scrolls controls clear of the sticky send bar.
              className="flex flex-col gap-4 [&_:is(a,button,input,textarea)]:scroll-mb-48"
            >
              {state.items.map((item) => (
                <li key={item.applicationId} className="min-w-0">
                  <MailCard
                    item={item}
                    onState={applyState}
                    onAnnounce={setAnnouncement}
                    onUnsavedChange={onUnsavedChange}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {hasItems && gmailReady && (
        <SendBar
          sendable={sendable}
          unsavedCount={validated.length - sendable.length}
          quota={state.quota}
          gmailEmail={gmail.email}
          pending={sending}
          error={sendError}
          onConfirm={confirmSend}
          onClearError={() => setSendError(null)}
        />
      )}
    </div>
  );
}
