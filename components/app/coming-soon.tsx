import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Placeholder for modules delivered in a later sprint (SPEC §13). */
export function ComingSoon({
  title,
  sprint,
  description,
}: {
  title: string;
  sprint: number;
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
          <p className="text-muted-foreground text-sm">Prévu au sprint {sprint}.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hunter">Aller au Chasseur</Link>
        </Button>
      </section>
    </div>
  );
}
