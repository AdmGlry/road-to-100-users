import { CheckIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "todo";

export type DashboardProgress = {
  /** First name from the profile, null when unknown. */
  firstName: string | null;
  profileDone: boolean;
  rolesCount: number;
  /** Companies proposed by the latest finished search, null when none finished yet. */
  leadsCount: number | null;
  searchRunning: boolean;
};

type Step = {
  id: string;
  title: string;
  description: string;
  doneNote: string;
  href: string;
  action: string;
  revisit: string;
};

const UPCOMING = [
  {
    title: "Relecture et envoi",
    description: "Connexion Gmail, mails personnalisés relus par toi puis envoyés avec ton CV.",
  },
  {
    title: "Suivi des réponses",
    description: "Tableau mis à jour automatiquement, relances et alertes d'entretien.",
  },
  {
    title: "Compte et données",
    description: "Parcours d'accueil guidé, gestion de ton compte et de tes données.",
  },
];

function buildSteps(p: DashboardProgress): { step: Step; state: StepState }[] {
  const steps: { step: Step; done: boolean }[] = [
    {
      done: p.profileDone,
      step: {
        id: "profile",
        title: "Importe ton CV et vérifie ton profil",
        description:
          "On pré-remplit ton profil à partir de ton CV. Tu corriges ce qui ne va pas : c'est la base de chaque candidature.",
        doneNote: "Profil rempli.",
        href: "/profile",
        action: "Importer mon CV",
        revisit: "Modifier mon profil",
      },
    },
    {
      done: p.rolesCount > 0,
      step: {
        id: "roles",
        title: "Choisis les métiers que tu vises",
        description:
          "Le coach te propose des métiers réalistes avec ton parcours. Ajoute ceux qui te plaisent à tes cibles.",
        doneNote:
          p.rolesCount > 1
            ? `${p.rolesCount} métiers dans tes cibles.`
            : "1 métier dans tes cibles.",
        href: "/profile#metiers",
        action: "Voir les métiers pour moi",
        revisit: "Revoir mes métiers",
      },
    },
    {
      done: p.leadsCount !== null,
      step: {
        id: "hunter",
        title: "Trouve des entreprises avec le Chasseur",
        description:
          "Le Chasseur cherche des entreprises près de chez toi et les note selon ton profil. Coche celles qui t'intéressent.",
        doneNote:
          p.leadsCount === null
            ? ""
            : p.leadsCount === 0
              ? "Dernière recherche : aucune entreprise trouvée."
              : `Dernière recherche : ${p.leadsCount} entreprise${p.leadsCount > 1 ? "s" : ""} proposée${p.leadsCount > 1 ? "s" : ""}.`,
        href: "/hunter",
        action: p.searchRunning ? "Suivre la recherche en cours" : "Lancer une recherche",
        revisit: "Voir les entreprises",
      },
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({
    step: s.step,
    state: s.done ? "done" : i === current ? "current" : "todo",
  }));
}

const STATE_LABEL: Record<StepState, string> = {
  done: "Fait",
  current: "À faire maintenant",
  todo: "Ensuite",
};

/** Operate-mode home: where the student stands, and the one next action. */
export function NextSteps({ progress }: { progress: DashboardProgress | null }) {
  const steps = progress
    ? buildSteps(progress)
    : buildSteps({
        firstName: null,
        profileDone: false,
        rolesCount: 0,
        leadsCount: null,
        searchRunning: false,
      }).map((s) => ({ ...s, state: "todo" as StepState }));
  const allDone = steps.every((s) => s.state === "done");

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">
          {progress?.firstName ? `Bonjour ${progress.firstName}` : "Bonjour"}
        </h1>
        <p className="text-muted-foreground max-w-[60ch]">
          {allDone
            ? "Tout est prêt. Reviens au Chasseur pour cocher les entreprises à qui écrire."
            : "Trois étapes, dans l'ordre, pour préparer tes candidatures spontanées."}
        </p>
        {!progress && (
          <p role="alert" className="text-destructive text-sm">
            Impossible de charger ton avancement pour le moment. Recharge la page dans un instant ;
            tes données ne sont pas perdues.
          </p>
        )}
      </div>

      <section aria-labelledby="next-steps-title" className="flex flex-col gap-3">
        <h2 id="next-steps-title" className="text-lg font-semibold">
          Tes étapes
        </h2>
        <ol className="bg-card divide-y overflow-hidden rounded-xl border">
          {steps.map(({ step, state }, i) => (
            <li
              key={step.id}
              aria-current={state === "current" ? "step" : undefined}
              className={cn("flex gap-4 p-4 sm:p-6", state === "current" && "bg-secondary/40")}
            >
              <StepMarker index={i + 1} state={state} />
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3
                      className={cn(
                        "leading-snug font-semibold",
                        state === "todo" && progress && "text-muted-foreground",
                      )}
                    >
                      {progress && <span className="sr-only">{STATE_LABEL[state]} : </span>}
                      {step.title}
                    </h3>
                    {state === "done" && (
                      <Badge variant="success" aria-hidden="true">
                        Fait
                      </Badge>
                    )}
                  </div>
                  {state === "done" ? (
                    <p className="text-muted-foreground text-sm">{step.doneNote}</p>
                  ) : (
                    <p className="text-muted-foreground max-w-[60ch] text-sm">{step.description}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {state === "current" ? (
                    <Button asChild className="w-full sm:w-auto">
                      <Link href={step.href}>{step.action}</Link>
                    </Button>
                  ) : state === "done" || !progress ? (
                    <Button asChild variant="outline" size="sm" className="w-fit">
                      <Link href={step.href}>{state === "done" ? step.revisit : step.action}</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {allDone && (
          <div>
            <Button asChild>
              <Link href="/hunter">Voir les entreprises proposées</Link>
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
        <h2 id="upcoming-title" className="text-lg font-semibold">
          Bientôt dans Spontané
        </h2>
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {UPCOMING.map((item) => (
            <li key={item.title} className="flex flex-col gap-1 border-t pt-3">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground text-sm">{item.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StepMarker({ index, state }: { index: number; state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
        state === "done" && "bg-success-soft text-success border-transparent",
        state === "current" && "bg-primary text-primary-foreground border-transparent",
        state === "todo" && "border-input text-muted-foreground",
      )}
    >
      {state === "done" ? <CheckIcon className="size-4" /> : index}
    </span>
  );
}

export function NextStepsSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bonjour</h1>
        <p className="sr-only" role="status">
          Chargement de ton avancement…
        </p>
        <div className="bg-muted h-5 w-2/3 max-w-md animate-pulse rounded" aria-hidden="true" />
      </div>
      <div className="bg-muted h-80 animate-pulse rounded-xl" aria-hidden="true" />
    </div>
  );
}
