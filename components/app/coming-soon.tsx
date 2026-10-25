import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Placeholder for modules delivered in a later sprint (SPEC §13). */
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  /** Planned sprint (SPEC §13); kept for reference, not shown to students. */
  sprint?: number;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <section
        aria-labelledby="coming-soon-title"
        className="bg-card flex flex-col items-start gap-4 rounded-xl border border-dashed p-6 sm:p-8"
      >
        <div className="flex flex-col gap-2">
          <h2 id="coming-soon-title" className="text-lg font-semibold">
            Bientôt disponible
          </h2>
          <p className="text-muted-foreground max-w-[60ch] leading-relaxed">{description}</p>
          <p className="text-muted-foreground text-sm">Arrive dans une prochaine version.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hunter">Aller au Chasseur</Link>
        </Button>
      </section>
    </div>
  );
}
