import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Paramètres · Spontané" };

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Paramètres"
      sprint={5}
      description="Gère ton compte, ta connexion Gmail, l'export et la suppression de tes données."
    />
  );
}
