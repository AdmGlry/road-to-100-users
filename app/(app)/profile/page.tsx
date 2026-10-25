import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Profil · Spontané" };

export default function ProfilePage() {
  return (
    <ComingSoon
      title="Profil"
      sprint={1}
      description="Importe ton CV en PDF : l'IA pré-remplit ton profil, que tu vérifies et complètes avec tes préférences de recherche."
    />
  );
}
