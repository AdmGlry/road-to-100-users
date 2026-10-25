import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Chasseur · Spontané" };

export default function HunterPage() {
  return (
    <ComingSoon
      title="Chasseur"
      sprint={2}
      description="Lance une recherche et reçois une liste d'entreprises notées selon ton profil, puis prépare des candidatures personnalisées."
    />
  );
}
