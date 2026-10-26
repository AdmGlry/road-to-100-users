import { percentLabel } from "@/components/tracker/tracker-utils";
import type { TrackerStats } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

/** Statistics band (SPEC §8.4): sent, reply rate, interviews, follow-ups to validate. */
export function StatsBand({ stats }: { stats: TrackerStats }) {
  const items: { label: string; value: string; detail?: string; highlight?: boolean }[] = [
    { label: stats.sent > 1 ? "Envoyés" : "Envoyé", value: String(stats.sent) },
    {
      label: "Taux de réponse",
      value: percentLabel(stats.replyRate),
      detail: `${stats.replied} réponse${stats.replied > 1 ? "s" : ""}`,
    },
    { label: stats.interviews > 1 ? "Entretiens" : "Entretien", value: String(stats.interviews) },
    {
      label: stats.pendingFollowups > 1 ? "Relances à valider" : "Relance à valider",
      value: String(stats.pendingFollowups),
      highlight: stats.pendingFollowups > 0,
    },
  ];

  return (
    <dl aria-label="Statistiques" className="bg-card grid grid-cols-4 divide-x rounded-xl border">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5 px-2 py-3 sm:px-4 sm:py-4">
          <dt className="text-muted-foreground order-2 text-xs leading-tight sm:text-sm">
            {item.label}
            {item.detail && <span className="sr-only"> ({item.detail})</span>}
          </dt>
          <dd
            className={cn(
              "order-1 text-xl font-semibold tabular-nums sm:text-2xl",
              item.highlight && "text-warning",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
