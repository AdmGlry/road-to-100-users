import type { CSSProperties, ReactNode } from "react";

import { PaperclipIcon } from "@phosphor-icons/react/ssr";

/**
 * The hero proof: an example of a prepared mail where every fact is traced
 * back to its source. Clearly labelled as fictional (no fake testimonial).
 * Loads in once (card, then its rows in reading order, then the source marks).
 */
export function ExampleMail() {
  return (
    <figure
      aria-labelledby="example-caption"
      style={delay(450)}
      className="bg-surface animate-landing-card w-full rounded-3xl border p-2"
    >
      <div className="bg-background overflow-hidden rounded-2xl border text-sm">
        <div
          style={delay(650)}
          className="animate-landing-up flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6"
        >
          <p className="font-semibold">Mail préparé pour toi</p>
          <span className="bg-raised text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
            Exemple fictif
          </span>
        </div>

        <dl
          style={delay(740)}
          className="animate-landing-up grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-4 py-3 sm:px-6"
        >
          <dt className="text-muted-foreground">À</dt>
          <dd className="truncate">Claire Morel, responsable financière</dd>
          <dt className="text-muted-foreground">Objet</dt>
          <dd>Candidature spontanée en alternance, contrôle de gestion</dd>
          <dt className="text-muted-foreground">
            <PaperclipIcon className="size-4 translate-y-0.5" aria-hidden="true" />
            <span className="sr-only">Pièce jointe</span>
          </dt>
          <dd className="truncate">CV_Lea_Martin.pdf</dd>
        </dl>

        <div className="flex flex-col gap-3 px-4 py-4 text-sm sm:px-6 sm:text-base">
          <p style={delay(830)} className="animate-landing-up">
            Bonjour Madame Morel,
          </p>
          <p style={delay(900)} className="animate-landing-up">
            J&apos;ai lu qu&apos;
            <Source n={1} popAt={1300}>
              Atelier Loire Conseil ouvre un second bureau à Angers
            </Source>{" "}
            cette année. Une équipe qui grandit doit suivre ses coûts de près, et c&apos;est ce que
            j&apos;apprends en{" "}
            <Source n={2} popAt={1400}>
              Master 1 Contrôle de gestion à l&apos;IAE Nantes
            </Source>
            .
          </p>
          <p style={delay(970)} className="animate-landing-up">
            Pendant{" "}
            <Source n={2} popAt={1500}>
              mon stage de 3 mois chez un distributeur de matériel agricole
            </Source>
            , j&apos;ai automatisé le reporting mensuel sous Excel. Je cherche une alternance de 12
            mois à partir de septembre et serais ravie d&apos;en parler avec vous.
          </p>
          <p style={delay(1040)} className="animate-landing-up">
            Léa Martin
          </p>
        </div>

        <figcaption
          id="example-caption"
          style={delay(1110)}
          className="bg-surface animate-landing-up border-t px-4 py-4 sm:px-6"
        >
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
          <p className="mt-3 font-medium">À relire. Rien ne part sans ton clic.</p>
        </figcaption>
      </div>
    </figure>
  );
}

function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}

function Source({ n, popAt, children }: { n: 1 | 2; popAt: number; children: ReactNode }) {
  return (
    <mark className="decoration-signal text-foreground bg-transparent underline decoration-2 underline-offset-4">
      {children}
      <sup
        style={delay(popAt)}
        className="text-signal animate-landing-pop ml-0.5 inline-block text-xs font-semibold"
      >
        <span className="sr-only">(source </span>
        {n}
        <span className="sr-only">)</span>
      </sup>
    </mark>
  );
}

function SourceNumber({ n }: { n: 1 | 2 }) {
  return (
    <span className="text-signal w-3 shrink-0 font-semibold tabular-nums" aria-hidden="true">
      {n}
    </span>
  );
}
