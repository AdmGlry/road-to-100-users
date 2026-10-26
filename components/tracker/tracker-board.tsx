"use client";

import { useId, useRef, useSyncExternalStore, type KeyboardEvent } from "react";

import { TrackerCard } from "@/components/tracker/tracker-card";
import { cardsByColumn } from "@/components/tracker/tracker-utils";
import { TRACKER_COLUMNS, type TrackerCard as Card, type TrackerColumn } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

const DESKTOP_QUERY = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** lg and up: the five columns side by side (tabs only below). */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

const EMPTY_TEXT: Record<TrackerColumn, string> = {
  sent: "Aucun mail en attente de réponse.",
  replied: "Aucune réponse pour l'instant.",
  interview: "Pas encore d'entretien. Ça viendra !",
  rejected: "Aucun refus.",
  no_reply: "Aucune candidature restée sans réponse.",
};

/**
 * Kanban (SPEC §8.4). Phone and tablet: a tab list of the five columns (with
 * counts) showing one column at a time as a vertical list. From lg: five
 * columns side by side, sized to fit without horizontal scrolling.
 */
export function TrackerBoard({
  cards,
  now,
  active,
  onActiveChange,
  onOpen,
}: {
  cards: Card[];
  now: number;
  active: TrackerColumn;
  onActiveChange: (column: TrackerColumn) => void;
  onOpen: (applicationId: string) => void;
}) {
  const uid = useId();
  const isDesktop = useIsDesktop();
  const byColumn = cardsByColumn(cards);
  const tabRefs = useRef<Partial<Record<TrackerColumn, HTMLButtonElement | null>>>({});
  const tabId = (c: TrackerColumn) => `${uid}-tab-${c}`;
  const panelId = (c: TrackerColumn) => `${uid}-panel-${c}`;

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TRACKER_COLUMNS.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const column = TRACKER_COLUMNS[next].id;
    onActiveChange(column);
    tabRefs.current[column]?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Colonnes du suivi"
        className="bg-muted grid grid-cols-5 gap-1 rounded-lg p-1 lg:hidden"
      >
        {TRACKER_COLUMNS.map((col, i) => {
          const selected = col.id === active;
          return (
            <button
              key={col.id}
              ref={(el) => {
                tabRefs.current[col.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(col.id)}
              aria-selected={selected}
              aria-controls={panelId(col.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onActiveChange(col.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                "flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-center",
                "transition-[background-color,color] duration-(--duration-fast) ease-(--ease-out)",
                selected
                  ? "bg-card text-primary ring-border font-semibold ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-base leading-none font-semibold tabular-nums">
                {byColumn[col.id].length}
              </span>
              <span className="text-[0.6875rem] leading-tight text-balance">{col.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {TRACKER_COLUMNS.map((col) => {
          const list = byColumn[col.id];
          const headingId = `${uid}-heading-${col.id}`;
          return (
            <section
              key={col.id}
              id={panelId(col.id)}
              role={isDesktop ? undefined : "tabpanel"}
              aria-labelledby={isDesktop ? headingId : tabId(col.id)}
              tabIndex={isDesktop ? undefined : -1}
              className={cn(
                "min-w-0 flex-col gap-2 outline-none lg:flex",
                col.id === active ? "flex" : "hidden",
              )}
            >
              <h2
                id={headingId}
                className="hidden items-baseline justify-between gap-2 px-1 text-sm font-semibold lg:flex"
              >
                <span className="min-w-0">{col.label}</span>
                <span className="text-muted-foreground tabular-nums">{list.length}</span>
              </h2>
              {list.length === 0 ? (
                <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-sm lg:text-xs">
                  {EMPTY_TEXT[col.id]}
                </p>
              ) : (
                <ul className="flex flex-col gap-2" aria-label={col.label}>
                  {list.map((card) => (
                    <li key={card.applicationId} className="min-w-0">
                      <TrackerCard card={card} now={now} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
