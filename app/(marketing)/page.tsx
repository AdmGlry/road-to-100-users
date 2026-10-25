import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    title: "Chasseur",
    description:
      "Spontané repère les entreprises proches de toi qui n'ont pas publié d'offre et les note selon ton profil.",
  },
  {
    title: "Relecture & envoi",
    description:
      "Un mail personnalisé est rédigé pour chaque entreprise. Tu relis, tu ajustes, tu valides : il part depuis ton Gmail avec ton CV.",
  },
  {
    title: "Suivi automatique",
    description:
      "Les réponses sont détectées dans ta boîte mail et ton tableau de bord se met à jour tout seul, relances comprises.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6">
        <span className="text-lg font-semibold tracking-tight">Spontané</span>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Se connecter</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 pt-12 pb-24 sm:pt-20">
        <section className="flex flex-col items-start gap-6">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Décroche ton alternance grâce à la candidature spontanée
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">
            Envoie 20 candidatures ciblées et personnalisées en moins de 15 minutes, puis suis les
            réponses sans rien saisir à la main.
          </p>
          <Button asChild size="lg">
            <Link href="/login">Commencer avec Google</Link>
          </Button>
        </section>

        <section aria-labelledby="how-it-works" className="flex flex-col gap-6">
          <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
            Comment ça marche
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <CardHeader>
                    <span
                      aria-hidden="true"
                      className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-full text-sm font-semibold"
                    >
                      {index + 1}
                    </span>
                    <CardTitle className="mt-2">
                      <h3>{step.title}</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">{step.description}</CardDescription>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-8 text-sm">
        Spontané · bêta fermée
      </footer>
    </div>
  );
}
