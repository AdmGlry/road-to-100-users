import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import {
  BuildingsIcon,
  GaugeIcon,
  GoogleLogoIcon,
  HandTapIcon,
  KanbanIcon,
  LockKeyIcon,
  PaperclipIcon,
  PenNibIcon,
  PlusIcon,
  SealCheckIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react/lib";

import { CONTAINER } from "@/components/marketing/container";
import {
  BENEFITS,
  CLOSING,
  FAQ,
  HERO,
  PROBLEM,
  RULES,
  SAMPLE_COMPANIES,
  STEPS,
  TAGLINE,
  TRACK,
  type BenefitKey,
  type RuleKey,
} from "@/components/marketing/content";
import { ExampleMail } from "@/components/marketing/example-mail";
import { TaglineReveal } from "@/components/marketing/tagline-reveal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Spontané, la candidature spontanée pour ton alternance ou ton stage",
  description:
    "Spontané trouve les entreprises qui n'ont publié aucune offre, rédige un mail tiré de ton CV pour chacune et suit les réponses dans ton Gmail. Tu valides chaque envoi.",
  alternates: { canonical: "/" },
};

const BENEFIT_ICONS: Record<BenefitKey, Icon> = {
  companies: BuildingsIcon,
  mail: PenNibIcon,
  gmail: PaperclipIcon,
  replies: KanbanIcon,
};

const RULE_ICONS: Record<RuleKey, Icon> = {
  truth: SealCheckIcon,
  consent: HandTapIcon,
  quota: GaugeIcon,
  gmail: LockKeyIcon,
};

/** Main call to action: 8px × 12px padding, 16px semibold (DESIGN.md "Landing"). */
const PRIMARY_BUTTON =
  "bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-base font-semibold transition-[background-color,scale] duration-300 ease-(--ease-landing) active:scale-[0.98]";

const SECTION_TITLE = "max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl";

/** Staggers sibling scroll reveals in reading order. */
function stagger(index: number): CSSProperties {
  return { transitionDelay: `${index * 80}ms` };
}

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Problem />
      <Benefits />
      <section aria-labelledby="tagline-title" className={`${CONTAINER} py-24`}>
        <TaglineReveal id="tagline-title" lines={TAGLINE} />
      </section>
      <HowItWorks />
      <Guarantees />
      <Questions />
      <Closing />
    </>
  );
}

function StartButton() {
  return (
    <Link href="/login" className={PRIMARY_BUTTON}>
      <GoogleLogoIcon weight="bold" className="size-5" aria-hidden="true" />
      {HERO.cta}
    </Link>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className={`${CONTAINER} flex flex-col items-center pt-24 pb-20 text-center lg:pb-24`}
    >
      <div className="flex flex-col items-center gap-6 pt-8 sm:pt-16">
        <h1
          id="hero-title"
          className="text-heading-gradient animate-landing-up max-w-[680px] pb-2 text-4xl font-semibold tracking-tight sm:text-5xl"
        >
          {HERO.titleLines[0]}
          <br className="hidden sm:inline" /> {HERO.titleLines[1]}
        </h1>
        <p
          style={{ animationDelay: "100ms" }}
          className="text-muted-foreground animate-landing-up max-w-[680px] text-lg"
        >
          {HERO.subtitle}
        </p>
        <div style={{ animationDelay: "200ms" }} className="animate-landing-up pt-2">
          <StartButton />
        </div>
        <p
          style={{ animationDelay: "300ms" }}
          className="text-muted-foreground animate-landing-up flex items-start gap-2 text-left text-sm sm:items-center"
        >
          <ShieldCheckIcon
            weight="fill"
            className="text-signal size-4 shrink-0 translate-y-0.5 sm:translate-y-0"
            aria-hidden="true"
          />
          {HERO.proof}
        </p>
      </div>
      <div className="mt-16 w-full max-w-2xl text-left">
        <ExampleMail />
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section aria-labelledby="problem-title" className="border-t">
      <div
        data-reveal=""
        className={`${CONTAINER} grid gap-8 py-20 lg:grid-cols-2 lg:gap-16 lg:py-24`}
      >
        <h2 id="problem-title" className={SECTION_TITLE}>
          {PROBLEM.title}
        </h2>
        <div className="flex flex-col gap-4 text-lg">
          <p className="text-muted-foreground">{PROBLEM.problem}</p>
          <p className="font-medium">{PROBLEM.solution}</p>
        </div>
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <section aria-labelledby="benefits-title" className={`${CONTAINER} pb-20 lg:pb-24`}>
      <h2 id="benefits-title" data-reveal="" className={SECTION_TITLE}>
        Ce que Spontané fait pour toi
      </h2>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map((benefit, index) => {
          const BenefitIcon = BENEFIT_ICONS[benefit.key];
          return (
            <li
              key={benefit.key}
              data-reveal=""
              style={stagger(index)}
              className="bg-surface flex flex-col gap-6 rounded-3xl border p-6 sm:p-8"
            >
              <BenefitIcon className="size-6" aria-hidden="true" />
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-semibold">{benefit.title}</h3>
                <p className="text-muted-foreground">{benefit.body}</p>
              </div>
              <BenefitVisual kind={benefit.key} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Small visual of each benefit card, with its story loop (design-to-motion):
 * it starts and ends on the resting design, runs only while the card is on
 * screen (`data-story`, see reveal-observer.tsx) and never with reduced motion.
 */
function BenefitVisual({ kind }: { kind: BenefitKey }) {
  if (kind === "companies") {
    // Story: a highlight inspects the companies one after another.
    return (
      <figure data-story="" className="mt-auto flex flex-col gap-2">
        <ul className="bg-background relative flex flex-col rounded-xl border p-1 text-sm">
          <li
            aria-hidden="true"
            className="bg-surface animate-story-rows absolute inset-x-1 top-1 h-14 rounded-md"
          />
          {SAMPLE_COMPANIES.map((company) => (
            <li
              key={company.name}
              className="relative flex h-14 items-center justify-between gap-3 px-3"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{company.name}</span>
                <span className="text-muted-foreground block truncate">{company.city}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  company.score >= 70 ? "bg-signal-soft text-signal" : "bg-raised",
                )}
              >
                {company.score}/100
              </span>
            </li>
          ))}
        </ul>
        <figcaption className="text-muted-foreground text-xs">Exemple fictif</figcaption>
      </figure>
    );
  }
  if (kind === "mail") {
    // Story: the source number pulses, pointing at where the fact comes from.
    return (
      <figure data-story="" className="mt-auto flex flex-col gap-2">
        <blockquote className="bg-background rounded-xl border px-4 py-3 text-sm">
          J&apos;ai lu qu&apos;
          <span className="decoration-signal underline decoration-2 underline-offset-4">
            Atelier Loire Conseil ouvre un second bureau à Angers
          </span>
          <SourcePulse /> cette année.
        </blockquote>
        <figcaption className="text-muted-foreground flex gap-2 text-xs">
          <span className="text-signal font-semibold">1</span>
          Source : l&apos;actualité publiée sur le site de l&apos;entreprise. Exemple fictif.
        </figcaption>
      </figure>
    );
  }
  if (kind === "gmail") {
    // Story: a sheen passes over the attachment, like a mail leaving.
    return (
      <p
        data-story=""
        className="bg-background relative mt-auto flex items-center gap-2 self-start overflow-hidden rounded-xl border px-3 py-2 text-sm"
      >
        <PaperclipIcon className="text-muted-foreground size-4" aria-hidden="true" />
        <span className="sr-only">Pièce jointe : </span>
        CV_Lea_Martin.pdf
        <span
          aria-hidden="true"
          className="bg-foreground/10 animate-story-sheen absolute inset-y-0 left-0 w-2/5 -skew-x-12"
        />
      </p>
    );
  }
  if (kind === "replies") {
    // Story: a reply travels the statuses, "Entretien" pops when it arrives.
    return (
      <ol
        data-story=""
        aria-label="Étapes du suivi"
        className="mt-auto flex flex-wrap items-center gap-2"
      >
        {TRACK.map((status, index) => {
          const last = index === TRACK.length - 1;
          return (
            <li key={status} className="flex items-center gap-2">
              <span
                className={cn(
                  "relative overflow-hidden rounded-full px-3 py-1 text-sm font-medium",
                  last ? "bg-signal-soft text-signal animate-story-pop" : "bg-raised",
                )}
              >
                {status}
                {last ? null : (
                  <span
                    aria-hidden="true"
                    style={{ animationDelay: `${index * 1200}ms` }}
                    className="bg-signal-soft text-signal animate-story-light absolute inset-0 flex items-center justify-center rounded-full opacity-0"
                  >
                    {status}
                  </span>
                )}
              </span>
              {last ? null : <span aria-hidden="true" className="bg-border h-0.5 w-3" />}
            </li>
          );
        })}
      </ol>
    );
  }
  return null;
}

function SourcePulse() {
  return (
    <sup className="text-signal relative ml-0.5 inline-flex font-semibold">
      <span
        aria-hidden="true"
        className="bg-signal animate-story-pulse absolute inset-0 m-auto size-3 rounded-full opacity-0"
      />
      <span className="relative">1</span>
    </sup>
  );
}

function HowItWorks() {
  return (
    <section
      id="fonctionnement"
      aria-labelledby="steps-title"
      className={`${CONTAINER} scroll-mt-24 pb-20 lg:pb-24`}
    >
      <h2 id="steps-title" data-reveal="" className={SECTION_TITLE}>
        Trois étapes, et tu décides à chacune
      </h2>
      <ol className="mt-12 grid gap-4 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            data-reveal=""
            style={stagger(index)}
            className="flex flex-col gap-4 rounded-3xl border p-6 sm:p-8"
          >
            <span
              aria-hidden="true"
              className="text-muted-foreground text-5xl font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <h3 className="text-xl font-semibold">
              <span className="sr-only">Étape {index + 1} : </span>
              {step.title}
            </h3>
            <p className="text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Guarantees() {
  return (
    <section
      id="garanties"
      aria-labelledby="rules-title"
      className="bg-surface scroll-mt-24 border-y"
    >
      <div className={`${CONTAINER} py-20 lg:py-24`}>
        <h2 id="rules-title" data-reveal="" className={SECTION_TITLE}>
          Les règles qu&apos;on ne contourne pas
        </h2>
        <dl className="mt-12 grid gap-x-16 gap-y-12 sm:grid-cols-2">
          {RULES.map((rule, index) => {
            const RuleIcon = RULE_ICONS[rule.key];
            return (
              <div
                key={rule.key}
                data-reveal=""
                style={stagger(index)}
                className="flex flex-col gap-3"
              >
                <dt className="flex items-center gap-3 text-xl font-semibold">
                  <RuleIcon weight="duotone" className="text-signal size-6" aria-hidden="true" />
                  {rule.title}
                </dt>
                <dd className="text-muted-foreground max-w-[480px]">{rule.body}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

function Questions() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return (
    <section
      id="questions"
      aria-labelledby="faq-title"
      className={`${CONTAINER} grid scroll-mt-24 gap-12 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16 lg:py-24`}
    >
      <div data-reveal="" className="flex flex-col gap-4">
        <h2 id="faq-title" className={SECTION_TITLE}>
          Tes questions, nos réponses
        </h2>
        <p className="text-muted-foreground text-lg">
          Ce que les étudiants nous demandent avant de connecter leur Gmail.
        </p>
      </div>
      <div data-reveal="" style={stagger(1)} className="flex flex-col gap-2">
        {FAQ.map((item) => (
          <details key={item.q} className="group bg-surface rounded-2xl border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-6 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <PlusIcon
                weight="bold"
                className="size-4 shrink-0 transition-transform duration-500 ease-(--ease-landing) group-open:rotate-45"
                aria-hidden="true"
              />
            </summary>
            <p className="text-muted-foreground px-6 pb-6">{item.a}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        // Static copy from content.ts; "<" escaped so the JSON can never close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
      />
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="close-title" className="border-t">
      <div
        data-reveal=""
        className={`${CONTAINER} flex flex-col items-center gap-6 py-20 text-center lg:py-24`}
      >
        <h2 id="close-title" className={SECTION_TITLE}>
          {CLOSING.titleLines[0]}
          <br className="hidden sm:inline" /> {CLOSING.titleLines[1]}
        </h2>
        <StartButton />
        <p className="text-muted-foreground text-sm">{CLOSING.reassurance}</p>
      </div>
    </section>
  );
}
