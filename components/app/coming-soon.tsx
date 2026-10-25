import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder card for modules delivered in a later sprint (SPEC §13). */
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
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Bientôt disponible (Sprint {sprint})</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
