import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Bienvenue · Spontané" };

export default function OnboardingPage() {
  return (
    <ComingSoon
      title="Bienvenue"
      sprint={5}
      description="Un parcours guidé en 3 étapes : ton CV, tes préférences, puis la connexion à Gmail."
    />
  );
}
