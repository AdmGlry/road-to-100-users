"use client";

import {
  CheckIcon,
  CompassIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

import { addTargetRoleAction, suggestRolesAction } from "@/app/(app)/profile/roles-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FIT_LABELS,
  markTargeted,
  mergeAnswers,
  titleKey,
  type RoleAnswer,
  type RoleFit,
  type RoleQuestion,
  type RoleSuggestion,
  type RoleSuggestions as RoleSuggestionsData,
} from "@/lib/profile/roles-schema";
import type { EditableProfile } from "@/lib/profile/schema";
import { cn } from "@/lib/utils";

const NETWORK_ERROR = "Connexion perdue. Vérifie ta connexion internet puis réessaie.";

export type RoleSuggestionsHandle = {
  /** Asks the coach once if there are no suggestions yet and nothing is loading. */
  requestIfEmpty: () => void;
};

type Status =
  | { kind: "idle"; announce: string }
  | { kind: "loading"; pendingAnswers: RoleAnswer[] }
  | { kind: "error"; message: string };

/**
 * "Métiers pour toi" — the guided coach d'orientation (Sprint 1.5). Shows the
 * coach's summary as a chat bubble, one card per suggested role (reasons,
 * point d'attention, sectors, "Ajouter à mes cibles") and the coach's
 * questions as option chips; answering and pressing "Affiner" asks again
 * with all the answers given so far.
 */
export function RoleSuggestions({
  initialSuggestions,
  targetRoles,
  disabled = false,
  onBeforeRequest,
  onTargetsUpdated,
  ref,
}: {
  initialSuggestions: RoleSuggestionsData | null;
  /** Current target_roles of the profile (drives the "Dans mes cibles" state). */
  targetRoles: readonly string[];
  disabled?: boolean;
  /** Saves pending form edits so the coach reads the latest profile; false if that failed. */
  onBeforeRequest: () => Promise<boolean>;
  onTargetsUpdated: (profile: EditableProfile, savedAt: string) => void;
  ref?: Ref<RoleSuggestionsHandle>;
}) {
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [status, setStatus] = useState<Status>({ kind: "idle", announce: "" });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<{ title: string; message: string } | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const loadingRef = useRef(false);
  const hasSuggestionsRef = useRef(initialSuggestions !== null);
  const headingId = useId();

  const loading = status.kind === "loading";

  const request = async (answers: Record<string, string>) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const pendingAnswers = Object.entries(answers)
      .filter(([q]) => !suggestions?.answers.some((a) => a.question === q))
      .map(([question, answer]) => ({ question, answer }));
    setStatus({ kind: "loading", pendingAnswers });
    try {
      if (!(await onBeforeRequest())) {
        setStatus({
          kind: "error",
          message:
            "Tes dernières modifications du profil n'ont pas pu être enregistrées. Réessaie.",
        });
        return;
      }
      const result = await suggestRolesAction(answers);
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      hasSuggestionsRef.current = true;
      setSuggestions(result.suggestions);
      setSelected({});
      setAddError(null);
      const n = result.suggestions.roles.length;
      setStatus({
        kind: "idle",
        announce: `Le coach te propose ${n} métier${n > 1 ? "s" : ""}.`,
      });
    } catch {
      setStatus({ kind: "error", message: NETWORK_ERROR });
    } finally {
      loadingRef.current = false;
    }
  };

  // No dependency list: the handle is refreshed on every render, so it always
  // calls the latest `request`.
  useImperativeHandle(ref, () => ({
    requestIfEmpty: () => {
      if (!hasSuggestionsRef.current && !loadingRef.current) void request({});
    },
  }));

  const addRole = async (role: RoleSuggestion) => {
    if (adding) return;
    setAdding(role.title);
    setAddError(null);
    try {
      if (!(await onBeforeRequest())) {
        setAddError({
          title: role.title,
          message: "Tes dernières modifications n'ont pas pu être enregistrées. Réessaie.",
        });
        return;
      }
      const result = await addTargetRoleAction(role.title, role.sectors);
      if (!result.ok) {
        setAddError({ title: role.title, message: result.message });
        return;
      }
      setAdded((prev) => new Set(prev).add(titleKey(role.title)));
      onTargetsUpdated(result.profile, result.savedAt);
    } catch {
      setAddError({ title: role.title, message: NETWORK_ERROR });
    } finally {
      setAdding(null);
    }
  };

  const view = suggestions ? markTargeted(suggestions, targetRoles) : null;
  const previousAnswers = view?.answers ?? [];
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const busy = disabled || loading;

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CoachAvatar />
          <div className="flex flex-col gap-1">
            <CardTitle>
              <h2 id={headingId} className="text-lg">
                Métiers pour toi
              </h2>
            </CardTitle>
            <CardDescription>
              Ton coach d&apos;orientation lit ton profil et te propose des métiers réalistes.
              Ajoute ceux qui te plaisent à tes cibles : ils servent à chercher des entreprises.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-col gap-3" aria-label="Échange avec le coach">
          {!view && !loading && (
            <CoachBubble>
              Salut ! Je peux te proposer des métiers auxquels tu peux vraiment postuler avec ton
              parcours, et te dire honnêtement ce qui pourrait coincer.
            </CoachBubble>
          )}
          {previousAnswers.map((a) => (
            <AnswerPair key={`prev-${a.question}`} question={a.question} answer={a.answer} />
          ))}
          {status.kind === "loading" &&
            status.pendingAnswers.map((a) => (
              <AnswerPair key={`pending-${a.question}`} question={a.question} answer={a.answer} />
            ))}
          {view && !loading && <CoachBubble>{view.summary}</CoachBubble>}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant={view ? "outline" : "default"}
            className="h-10"
            onClick={() => void request(view ? answersRecord(previousAnswers) : {})}
            disabled={busy}
          >
            {loading ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : view ? (
              <RefreshCwIcon aria-hidden="true" />
            ) : (
              <SparklesIcon aria-hidden="true" />
            )}
            {view ? "Actualiser" : "Me proposer des métiers"}
          </Button>
        </div>

        <div aria-live="polite" role="status" className="text-sm empty:hidden">
          {status.kind === "loading" && (
            <p className="text-muted-foreground inline-flex items-center gap-2">
              <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
              Le coach lit ton profil…
            </p>
          )}
          {status.kind === "idle" && status.announce && (
            <p className="sr-only">{status.announce}</p>
          )}
        </div>
        {status.kind === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {status.message}
          </p>
        )}

        {view && view.roles.length > 0 && (
          <ul
            className={cn("flex flex-col gap-3", loading && "opacity-60")}
            aria-label="Métiers suggérés"
            aria-busy={loading}
          >
            {view.roles.map((role) => {
              const inTargets = role.alreadyTargeted || added.has(titleKey(role.title));
              return (
                <li key={role.title}>
                  <RoleCard
                    role={role}
                    inTargets={inTargets}
                    pending={adding === role.title}
                    disabled={busy || (adding !== null && adding !== role.title)}
                    error={addError?.title === role.title ? addError.message : null}
                    onAdd={() => void addRole(role)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {view && view.questions.length > 0 && !loading && (
          <section className="flex flex-col gap-3" aria-label="Questions du coach">
            <p className="text-muted-foreground text-sm">
              Réponds à une ou plusieurs questions pour que le coach affine ses suggestions.
            </p>
            {view.questions.map((q) => (
              <QuestionBubble
                key={q.id}
                question={q}
                value={selected[q.question] ?? null}
                disabled={busy}
                onChange={(option) =>
                  setSelected((s) => ({
                    ...s,
                    [q.question]: s[q.question] === option ? "" : option,
                  }))
                }
              />
            ))}
            <div>
              <Button
                type="button"
                onClick={() => void request(mergeAnswers(previousAnswers, selected))}
                disabled={busy || selectedCount === 0}
                className="h-10"
              >
                <SparklesIcon aria-hidden="true" />
                Affiner les suggestions
              </Button>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function answersRecord(list: readonly RoleAnswer[]): Record<string, string> {
  return mergeAnswers(list, {});
}

function CoachAvatar() {
  return (
    <span
      className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      role="img"
      aria-label="Coach"
    >
      <CompassIcon aria-hidden="true" className="size-5" />
    </span>
  );
}

function CoachBubble({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="sr-only">Coach :</span>
      <div className="bg-muted max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm sm:max-w-[80%]">
        {children}
      </div>
    </li>
  );
}

function StudentBubble({ children }: { children: ReactNode }) {
  return (
    <li className="flex justify-end">
      <span className="sr-only">Toi :</span>
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm sm:max-w-[70%]">
        {children}
      </div>
    </li>
  );
}

function AnswerPair({ question, answer }: { question: string; answer: string }) {
  return (
    <>
      <CoachBubble>{question}</CoachBubble>
      <StudentBubble>{answer}</StudentBubble>
    </>
  );
}

const FIT_BADGE: Record<RoleFit, "default" | "secondary" | "outline"> = {
  fort: "default",
  moyen: "secondary",
  "à explorer": "outline",
};

function RoleCard({
  role,
  inTargets,
  pending,
  disabled,
  error,
  onAdd,
}: {
  role: RoleSuggestion;
  inTargets: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  onAdd: () => void;
}) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="font-medium">
          {role.title}
        </h3>
        <Badge variant={FIT_BADGE[role.fit]}>
          {role.fit === "à explorer" && <LightbulbIcon aria-hidden="true" className="size-3" />}
          {FIT_LABELS[role.fit]}
        </Badge>
      </div>

      <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
        {role.why.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      {role.gap && (
        <div className="bg-accent/60 border-border rounded-md border-l-4 px-3 py-2 text-sm">
          <p className="font-medium">Point d&apos;attention</p>
          <p className="text-muted-foreground">{role.gap}</p>
        </div>
      )}

      {role.sectors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="sr-only">Secteurs où ce métier est courant :</span>
          <ul className="flex flex-wrap gap-1.5" aria-label="Secteurs">
            {role.sectors.map((sector) => (
              <li key={sector}>
                <Badge variant="secondary" className="font-normal">
                  {sector}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div>
          {inTargets ? (
            <Button type="button" size="sm" variant="secondary" className="h-10" disabled>
              <CheckIcon aria-hidden="true" />
              Dans mes cibles
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10"
              onClick={onAdd}
              disabled={disabled || pending}
              aria-describedby={titleId}
            >
              {pending ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
              Ajouter à mes cibles
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function QuestionBubble({
  question,
  value,
  disabled,
  onChange,
}: {
  question: RoleQuestion;
  value: string | null;
  disabled: boolean;
  onChange: (option: string) => void;
}) {
  const legendId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start">
        <p
          id={legendId}
          className="bg-muted max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm sm:max-w-[80%]"
        >
          <span className="sr-only">Coach : </span>
          {question.question}
        </p>
      </div>
      <div role="group" aria-labelledby={legendId} className="flex flex-wrap gap-2 pl-2">
        {question.options.map((option) => {
          const active = value === option;
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-10 rounded-full"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(option)}
            >
              {active && <CheckIcon aria-hidden="true" />}
              {option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
