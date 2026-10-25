import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Suivi · Spontané" };

export default function TrackerPage() {
  return (
    <ComingSoon
      title="Suivi"
      sprint={4}
      description="Un tableau Kanban mis à jour automatiquement à partir des réponses reçues dans ton Gmail, avec des relances proposées."
    />
  );
}
