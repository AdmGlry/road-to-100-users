import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Tableau de bord · Spontané" };

const ROADMAP = [
  { sprint: 1, title: "Profil", description: "Import du CV et profil pré-rempli, éditable." },
  { sprint: 2, title: "Chasseur", description: "Recherche d'entreprises notées selon ton profil." },
  {
    sprint: 3,
    title: "Relecture & envoi",
    description: "Connexion Gmail, mails personnalisés relus puis envoyés avec ton CV.",
  },
  {
    sprint: 4,
    title: "Suivi",
    description: "Kanban mis à jour automatiquement, relances et alertes d'entretien.",
  },
  {
    sprint: 5,
    title: "Bêta",
    description: "Onboarding guidé, gestion du compte et de tes données.",
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<h1 className="text-2xl font-semibold tracking-tight">Bonjour</h1>}>
        <Greeting />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Ton profil</h2>
          </CardTitle>
          <CardDescription>
            Importe ton CV et indique ce que tu cherches : c&apos;est la base de toutes tes
            candidatures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/profile">Compléter mon profil</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Chasseur</h2>
          </CardTitle>
          <CardDescription>
            Trouve des entreprises près de chez toi, notées selon ton profil, et sélectionne celles
            à qui envoyer une candidature spontanée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/hunter">Lancer une recherche</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Ce qui arrive</h2>
          </CardTitle>
          <CardDescription>Spontané se construit sprint par sprint.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-4">
            {ROADMAP.map((item) => (
              <li key={item.sprint} className="flex items-start gap-3">
                <Badge variant="secondary" className="mt-0.5 shrink-0">
                  Sprint {item.sprint}
                </Badge>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-muted-foreground text-sm">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

async function Greeting() {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight break-words">
        Bonjour {user?.email ?? ""}
      </h1>
      <p className="text-muted-foreground">Bienvenue sur Spontané, ton compte est prêt.</p>
    </div>
  );
}
