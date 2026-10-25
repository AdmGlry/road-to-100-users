import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Spontané, la candidature spontanée pour ton alternance ou ton stage",
};

const STEPS = [
  {
    title: "Spontané chasse les entreprises qui n'ont rien publié",
    body: "À partir de ton CV et de ce que tu cherches (alternance ou stage, métier, ville, rayon), Spontané fouille le registre public des entreprises et garde celles qui te correspondent.",
    detail:
      "Chaque entreprise reçoit une note sur 100 et deux ou trois raisons. Tu coches celles qui te parlent.",
  },
  {
    title: "Tu relis chaque mail, puis tu l'envoies",
    body: "Pour chaque entreprise cochée, Spontané trouve un contact, lit l'actualité de l'entreprise et rédige un mail qui part de ton parcours.",
    detail:
      "Tu modifies, tu régénères ou tu ignores. Une fois validé, le mail part depuis ton Gmail avec ton CV en pièce jointe.",
  },
  {
    title: "Les réponses se rangent toutes seules",
    body: "Spontané lit uniquement les réponses à tes candidatures et met ton tableau de suivi à jour. Tu n'as rien à recopier.",
    detail:
      "Sans réponse au bout de 7 jours, une relance rédigée t'est proposée. Elle aussi attend ta validation.",
  },
] as const;

const TRACK = ["Envoyé", "Réponse reçue", "Entretien"] as const;

const RULES = [
  {
    title: "Rien n'est inventé.",
    body: "L'IA n'écrit que ce qui figure dans ton profil ou dans une source publique sur l'entreprise. Aucune expérience, aucun diplôme, aucune compétence que tu n'as pas.",
  },
  {
    title: "Tu valides chaque mail.",
    body: "Aucun envoi automatique. Tu relis, tu ajustes si besoin, et rien ne part sans ton clic.",
  },
  {
    title: "20 envois max par jour.",
    body: "Un plafond appliqué par nos serveurs, pour protéger ta boîte Gmail et ta réputation auprès des recruteurs.",
  },
  {
    title: "Ton Gmail, juste ce qu'il faut.",
    body: "Spontané envoie tes candidatures et ne lit que les réponses qu'elles reçoivent. Tu peux supprimer ton compte et toutes tes données quand tu veux.",
  },
] as const;

const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className={`${CONTAINER} flex h-16 items-center justify-between gap-4 sm:h-20`}>
        <Link
          href="/"
          className="font-display -mx-1 inline-flex h-10 items-center rounded-sm px-1 text-xl"
        >
          Spontané
        </Link>
        <nav aria-label="Navigation" className="flex items-center gap-2 sm:gap-4">
          <a
            href="#etapes"
            className="text-muted-foreground hover:text-foreground hidden h-10 items-center rounded-sm px-2 text-sm font-medium transition-colors sm:inline-flex"
          >
            Comment ça marche
          </a>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Se connecter</Link>
          </Button>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section
          aria-labelledby="hero-title"
          className={`${CONTAINER} grid items-center gap-12 pt-8 pb-20 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:pt-16 lg:pb-28 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]`}
        >
          <div className="flex flex-col items-start gap-7">
            <h1
              id="hero-title"
              className="font-display max-w-[13ch] text-[clamp(2.5rem,1.2rem+5vw,4.5rem)]"
            >
              20 candidatures spontanées en moins de 15 minutes.
            </h1>
            <p className="text-muted-foreground max-w-[34rem] text-lg leading-relaxed">
              Spontané repère les entreprises près de chez toi qui n&apos;ont publié aucune offre,
              rédige pour chacune un mail tiré de ton CV, puis suit les réponses dans ton Gmail.
              Toi, tu relis et tu valides.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-5">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/login">Commencer avec Google</Link>
              </Button>
              <a
                href="#etapes"
                className="text-primary decoration-primary/40 hover:decoration-primary inline-flex h-11 items-center justify-center rounded-sm text-base font-semibold underline underline-offset-4 transition-colors"
              >
                Voir les étapes
              </a>
            </div>
            <p className="text-muted-foreground text-sm">
              Bêta fermée pour les étudiants de l&apos;IAE Nantes, en alternance ou en stage.
            </p>
          </div>

          <ExampleMail />
        </section>

        <section id="etapes" aria-labelledby="steps-title" className="scroll-mt-6 border-t">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-16">
              <h2
                id="steps-title"
                className="font-display text-[clamp(2rem,1.4rem+2.4vw,3rem)] lg:max-w-[12ch]"
              >
                Trois étapes, et tu décides à chacune.
              </h2>
              <p className="text-muted-foreground max-w-[38rem] text-lg leading-relaxed lg:pt-2">
                Les entreprises qui recrutent sans publier d&apos;offre attendent qu&apos;on vienne
                frapper à leur porte. Spontané fait la recherche et le premier jet, tu gardes la
                main sur ce qui part.
              </p>
            </div>

            <ol className="mt-14 flex flex-col lg:mt-20">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-t py-8 first:border-t-0 first:pt-0 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-6 lg:grid-cols-[6rem_minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-10 lg:py-10"
                >
                  <span
                    aria-hidden="true"
                    className="font-display text-primary text-[2.5rem] tabular-nums sm:text-6xl"
                  >
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-xl leading-snug font-bold sm:text-2xl">
                      <span className="sr-only">Étape {index + 1} : </span>
                      {step.title}
                    </h3>
                    <p className="max-w-[40rem] leading-relaxed">{step.body}</p>
                  </div>
                  <div className="col-start-2 flex flex-col gap-4 lg:col-start-3 lg:pt-1.5">
                    <p className="text-muted-foreground leading-relaxed">{step.detail}</p>
                    {index === 2 ? <StatusTrack /> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="rules-title" className="bg-band text-band-foreground">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2
              id="rules-title"
              className="font-display max-w-[16ch] text-[clamp(2rem,1.4rem+2.4vw,3rem)]"
            >
              Les règles qu&apos;on ne contourne pas.
            </h2>
            <dl className="mt-12 grid gap-x-16 gap-y-10 sm:grid-cols-2 lg:mt-16">
              {RULES.map((rule) => (
                <div key={rule.title} className="border-band-foreground/25 border-t pt-6">
                  <dt className="text-2xl leading-tight font-bold sm:text-[1.75rem]">
                    {rule.title}
                  </dt>
                  <dd className="text-band-muted mt-3 max-w-[30rem] text-lg leading-relaxed">
                    {rule.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="close-title">
          <div
            className={`${CONTAINER} flex flex-col items-start gap-6 py-20 lg:flex-row lg:items-end lg:justify-between lg:gap-16 lg:py-28`}
          >
            <div className="flex max-w-[40rem] flex-col gap-4">
              <h2 id="close-title" className="font-display text-[clamp(2rem,1.4rem+2.4vw,3rem)]">
                Ta prochaine alternance n&apos;est peut‑être publiée nulle part.
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Commence par ton CV. Le reste prend un quart d&apos;heure.
              </p>
            </div>
            <Button asChild size="lg" className="w-full shrink-0 sm:w-auto">
              <Link href="/login">Commencer avec Google</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div
          className={`${CONTAINER} text-muted-foreground flex flex-col gap-2 py-8 text-sm sm:flex-row sm:items-center sm:justify-between`}
        >
          <p>Spontané, en bêta fermée.</p>
          <Link
            href="/login"
            className="hover:text-foreground -mx-1 inline-flex h-10 items-center self-start rounded-sm px-1 underline underline-offset-4 sm:self-auto"
          >
            Se connecter
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * The hero proof: an example of a prepared mail where every fact is traced
 * back to its source. Clearly labelled as fictional (no fake testimonial).
 */
function ExampleMail() {
  return (
    <figure className="relative w-full" aria-labelledby="example-caption">
      <div className="bg-card overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgb(23_27_52/0.06),0_28px_56px_-28px_rgb(43_63_214/0.4)]">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <p className="text-sm font-semibold">Mail préparé pour toi</p>
          <Badge variant="outline">Exemple fictif</Badge>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b px-5 py-4 text-sm">
          <dt className="text-muted-foreground">À</dt>
          <dd className="truncate">Claire Morel, responsable financière</dd>
          <dt className="text-muted-foreground">Objet</dt>
          <dd>Candidature spontanée en alternance, contrôle de gestion</dd>
          <dt className="text-muted-foreground">Pièce jointe</dt>
          <dd className="truncate">CV_Lea_Martin.pdf</dd>
        </dl>

        <div className="relative py-5 pr-5 pl-11 text-[0.9375rem] leading-relaxed sm:pl-14">
          <span
            aria-hidden="true"
            className="bg-margin-rule/50 absolute inset-y-0 left-7 w-px sm:left-9"
          />
          <p>Bonjour Madame Morel,</p>
          <p className="mt-3">
            J&apos;ai lu que{" "}
            <Source n={1} delay={500}>
              Atelier Loire Conseil ouvre un second bureau à Saint-Nazaire
            </Source>{" "}
            cette année. Une équipe qui grandit doit suivre ses coûts de près, et c&apos;est ce que
            j&apos;apprends en{" "}
            <Source n={2} delay={800}>
              Master 1 Contrôle de gestion à l&apos;IAE Nantes
            </Source>
            .
          </p>
          <p className="mt-3">
            Pendant{" "}
            <Source n={2} delay={1100}>
              mon stage de 3 mois chez un distributeur de matériel agricole
            </Source>
            , j&apos;ai automatisé le reporting mensuel sous Excel. Je cherche une alternance de 12
            mois à partir de septembre. Auriez-vous un moment pour en parler ?
          </p>
          <p className="mt-3">Léa Martin</p>
        </div>

        <figcaption id="example-caption" className="bg-muted/60 border-t px-5 py-4 text-sm">
          <p className="font-semibold">D&apos;où vient chaque phrase</p>
          <ol className="text-muted-foreground mt-2 flex flex-col gap-1">
            <li className="flex gap-2">
              <SourceNumber n={1} />
              L&apos;actualité publiée sur le site de l&apos;entreprise.
            </li>
            <li className="flex gap-2">
              <SourceNumber n={2} />
              Ton CV, rubriques Formation et Expériences.
            </li>
          </ol>
          <p className="text-foreground mt-3 flex items-center gap-2 font-medium">
            <span aria-hidden="true" className="bg-warning size-2 shrink-0 rounded-full" />À relire.
            Rien ne part sans ton accord.
          </p>
        </figcaption>
      </div>
    </figure>
  );
}

function Source({ n, delay, children }: { n: 1 | 2; delay: number; children: ReactNode }) {
  return (
    <mark
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
      className="animate-source-mark text-foreground bg-transparent bg-[linear-gradient(var(--success),var(--success))] bg-[length:100%_2px] bg-bottom-left bg-no-repeat pb-px"
    >
      {children}
      <sup className="text-success ml-0.5 text-[0.7em] font-bold">
        <span className="sr-only">(source </span>
        {n}
        <span className="sr-only">)</span>
      </sup>
    </mark>
  );
}

function SourceNumber({ n }: { n: 1 | 2 }) {
  return (
    <span className="text-success w-3 shrink-0 font-bold tabular-nums" aria-hidden="true">
      {n}
    </span>
  );
}

/** The real tracker columns (SPEC §2.7), drawn as the path a reply takes. */
function StatusTrack() {
  return (
    <ol aria-label="Étapes du suivi" className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {TRACK.map((status, index) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            className={
              index === TRACK.length - 1
                ? "bg-success-soft text-success rounded-sm px-2 py-1 text-[0.8125rem] font-semibold"
                : "bg-secondary text-secondary-foreground rounded-sm px-2 py-1 text-[0.8125rem] font-semibold"
            }
          >
            {status}
          </span>
          {index < TRACK.length - 1 ? (
            <span aria-hidden="true" className="bg-input h-px w-3" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
