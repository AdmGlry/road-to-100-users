"use client";

import { AlertCircleIcon, CheckIcon, LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { saveProfileAction } from "@/app/(app)/profile/actions";
import {
  applyPatch,
  CONTRACT_TYPE_LABELS,
  diffProfile,
  formatSavedTime,
} from "@/components/profile/profile-utils";
import { TagInput } from "@/components/profile/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTRACT_TYPES,
  type ContractType,
  type EditableProfile,
  type Education,
  type Experience,
  type Language,
} from "@/lib/profile/schema";
import { cn } from "@/lib/utils";

const AUTOSAVE_DELAY_MS = 800;
const RADIUS_MIN = 5;
const RADIUS_MAX = 200;

export type ProfileFormHandle = {
  /** Saves pending edits now. Resolves to false if the save failed. */
  flush: () => Promise<boolean>;
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

/**
 * Editable profile with autosave (SPEC §5.3): ~800 ms after the last change,
 * only the changed fields are sent. Saves are flushed when a field loses
 * focus, when the tab is hidden and before the page unloads.
 */
export function ProfileForm({
  initialProfile,
  initialSavedAt,
  disabled = false,
  ref,
}: {
  initialProfile: EditableProfile;
  initialSavedAt?: string | null;
  disabled?: boolean;
  ref?: Ref<ProfileFormHandle>;
}) {
  const [values, setValues] = useState(initialProfile);
  const [status, setStatus] = useState<SaveStatus>(
    initialSavedAt ? { kind: "saved", at: initialSavedAt } : { kind: "idle" },
  );

  const valuesRef = useRef(initialProfile); // latest edits (read by async save)
  const confirmedRef = useRef(initialProfile); // what the server is known to hold
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0); // id of the latest save request
  const inFlightRef = useRef(0);

  const save = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = diffProfile(confirmedRef.current, valuesRef.current);
    if (Object.keys(patch).length === 0) {
      if (inFlightRef.current === 0) {
        setStatus((s) => (s.kind === "pending" ? { kind: "idle" } : s));
      }
      return true;
    }

    const seq = ++seqRef.current;
    inFlightRef.current += 1;
    setStatus({ kind: "saving" });
    try {
      const result = await saveProfileAction(patch);
      if (result.ok) {
        confirmedRef.current = applyPatch(confirmedRef.current, patch);
        // Only the latest request drives the indicator (stale responses are ignored).
        const nothingLeft =
          Object.keys(diffProfile(confirmedRef.current, valuesRef.current)).length === 0;
        if (seq === seqRef.current && nothingLeft) {
          setStatus({ kind: "saved", at: result.savedAt });
        }
        return true;
      }
      if (seq === seqRef.current) setStatus({ kind: "error", message: result.message });
      return false;
    } catch {
      if (seq === seqRef.current) {
        setStatus({
          kind: "error",
          message: "Connexion perdue : tes dernières modifications ne sont pas enregistrées.",
        });
      }
      return false;
    } finally {
      inFlightRef.current -= 1;
    }
  }, []);

  const flushIfPending = useCallback(() => {
    if (timerRef.current) void save();
  }, [save]);

  useImperativeHandle(ref, () => ({ flush: save }), [save]);

  // Flush when the tab is hidden (iOS rarely fires beforeunload) and warn before leaving.
  useEffect(() => {
    const hasUnsaved = () =>
      timerRef.current !== null ||
      inFlightRef.current > 0 ||
      Object.keys(diffProfile(confirmedRef.current, valuesRef.current)).length > 0;

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && hasUnsaved()) void save();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      void save();
      event.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [save]);

  const update = useCallback(
    <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
      const next = { ...valuesRef.current, [key]: value };
      valuesRef.current = next;
      setValues(next);
      setStatus((s) => (s.kind === "saving" ? s : { kind: "pending" }));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void save();
      }, AUTOSAVE_DELAY_MS);
    },
    [save],
  );

  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onBlur={flushIfPending}
      aria-label="Mon profil"
      // Fields focused from the keyboard stop below the sticky save indicator.
      className="flex flex-col gap-6 [&_:is(input,textarea,select,button)]:scroll-mt-16"
    >
      <SaveIndicator status={status} onRetry={() => void save()} />

      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
        <legend className="sr-only">Informations du profil</legend>

        <Section title="Identité" description="Ces informations apparaissent dans tes mails.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={fid("full_name")}
              label="Nom complet"
              value={values.full_name}
              onChange={(v) => update("full_name", v)}
              autoComplete="name"
            />
            <TextField
              id={fid("email")}
              label="E-mail"
              type="email"
              value={values.email}
              onChange={(v) => update("email", v)}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              autoCapitalize="none"
            />
            <TextField
              id={fid("phone")}
              label="Téléphone"
              type="tel"
              value={values.phone}
              onChange={(v) => update("phone", v)}
              autoComplete="tel"
              hint="Facultatif."
            />
            <TextField
              id={fid("city")}
              label="Ville"
              value={values.city}
              onChange={(v) => update("city", v)}
              autoComplete="address-level2"
              hint="Sert de point de départ pour la recherche d'entreprises."
            />
          </div>
        </Section>

        <Section title="Formation">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={fid("school")}
              label="École actuelle"
              value={values.school}
              onChange={(v) => update("school", v)}
            />
            <TextField
              id={fid("degree")}
              label="Diplôme préparé"
              value={values.degree}
              onChange={(v) => update("degree", v)}
              placeholder="ex. Master MSI"
            />
          </div>
          <EducationList
            idPrefix={fid("education")}
            items={values.education}
            onChange={(v) => update("education", v)}
          />
        </Section>

        <Section
          title="Expériences"
          description="Stages, alternances, jobs, projets, associations."
        >
          <ExperienceList
            idPrefix={fid("experiences")}
            items={values.experiences}
            onChange={(v) => update("experiences", v)}
          />
        </Section>

        <Section title="Compétences">
          <Field
            id={fid("skills")}
            label="Compétences"
            hint="Outils, langages, méthodes… uniquement ce que tu maîtrises vraiment."
          >
            {(describedBy) => (
              <TagInput
                id={fid("skills")}
                value={values.skills}
                onChange={(v) => update("skills", v)}
                describedBy={describedBy}
                placeholder="ex. Excel, SQL, gestion de projet"
              />
            )}
          </Field>
        </Section>

        <Section title="Langues">
          <LanguageList
            idPrefix={fid("languages")}
            items={values.languages}
            onChange={(v) => update("languages", v)}
          />
        </Section>

        <Section title="Pitch">
          <Field
            id={fid("pitch")}
            label="Ta présentation en quelques mots"
            hint="2 à 3 phrases, à la première personne, factuelles. Elle sert de base à tes mails de candidature."
          >
            {(describedBy) => (
              <Textarea
                id={fid("pitch")}
                value={values.pitch ?? ""}
                onChange={(e) => update("pitch", e.target.value)}
                aria-describedby={describedBy}
                rows={4}
                maxLength={1000}
              />
            )}
          </Field>
        </Section>

        <Section
          title="Préférences de recherche"
          description="Elles servent à trouver les entreprises qui te correspondent."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={fid("contract_type")} label="Type de contrat">
              {(describedBy) => (
                <NativeSelect
                  id={fid("contract_type")}
                  value={values.contract_type ?? ""}
                  onChange={(e) =>
                    update(
                      "contract_type",
                      e.target.value === "" ? null : (e.target.value as ContractType),
                    )
                  }
                  aria-describedby={describedBy}
                >
                  <option value="">Choisir…</option>
                  {CONTRACT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CONTRACT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <TextField
              id={fid("rhythm")}
              label="Rythme"
              value={values.rhythm}
              onChange={(v) => update("rhythm", v)}
              placeholder="ex. 3 semaines entreprise / 1 semaine école"
              hint="Surtout utile pour une alternance."
            />
            <Field id={fid("start_date")} label="Date de début souhaitée">
              {(describedBy) => (
                <Input
                  id={fid("start_date")}
                  type="date"
                  value={values.start_date ?? ""}
                  onChange={(e) => update("start_date", e.target.value || null)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <RadiusField
              id={fid("search_radius_km")}
              value={values.search_radius_km}
              onChange={(v) => update("search_radius_km", v)}
            />
          </div>
          <Field
            id={fid("target_roles")}
            label="Postes visés"
            hint="ex. Business Analyst, Chef de projet MOA."
          >
            {(describedBy) => (
              <TagInput
                id={fid("target_roles")}
                value={values.target_roles}
                onChange={(v) => update("target_roles", v)}
                describedBy={describedBy}
                placeholder="Ajouter un poste"
              />
            )}
          </Field>
          <Field
            id={fid("target_sectors")}
            label="Secteurs visés"
            hint="ex. Banque, Conseil, Industrie. Laisse vide si tout t'intéresse."
          >
            {(describedBy) => (
              <TagInput
                id={fid("target_sectors")}
                value={values.target_sectors}
                onChange={(v) => update("target_sectors", v)}
                describedBy={describedBy}
                placeholder="Ajouter un secteur"
              />
            )}
          </Field>
        </Section>
      </fieldset>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Save indicator
// ---------------------------------------------------------------------------

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  let content: ReactNode = null;
  switch (status.kind) {
    case "pending":
    case "saving":
      content = (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Enregistrement…
        </>
      );
      break;
    case "saved":
      content = (
        <>
          <CheckIcon aria-hidden="true" className="size-4" />
          Enregistré à {formatSavedTime(status.at)}
        </>
      );
      break;
    case "error":
      content = (
        <span className="text-destructive inline-flex items-start gap-2 wrap-anywhere">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </span>
      );
      break;
    default:
      content = "Les modifications sont enregistrées automatiquement.";
  }

  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 -mx-1 flex min-h-10 flex-wrap items-center justify-between gap-2 px-1 py-2 backdrop-blur">
      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground inline-flex items-center gap-2 text-sm"
      >
        {content}
      </p>
      {status.kind === "error" && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} role="region" className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 id={headingId} className="text-lg">
            {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

/** Visible label + control + optional hint, wired with aria-describedby. */
function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(describedBy)}
      {hint && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  spellCheck,
  autoCapitalize,
  className,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  hint?: string;
  type?: "text" | "email" | "tel";
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "email" | "tel" | "text";
  spellCheck?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  className?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} className={className}>
      {(describedBy) => (
        <Input
          id={id}
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          spellCheck={spellCheck}
          autoCapitalize={autoCapitalize}
          aria-describedby={describedBy}
        />
      )}
    </Field>
  );
}

function RadiusField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  const parse = (text: string): number | null => {
    if (!/^\d+$/.test(text.trim())) return null;
    const n = Number.parseInt(text, 10);
    return n >= RADIUS_MIN && n <= RADIUS_MAX ? n : null;
  };

  return (
    <Field
      id={id}
      label="Rayon de recherche"
      hint={`Autour de ta ville, de ${RADIUS_MIN} à ${RADIUS_MAX} km.`}
      error={error}
    >
      {(describedBy) => (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={5}
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="w-28"
            onChange={(e) => {
              setDraft(e.target.value);
              const n = parse(e.target.value);
              if (n === null) {
                setError(`Indique un nombre entre ${RADIUS_MIN} et ${RADIUS_MAX}.`);
              } else {
                setError(null);
                if (n !== value) onChange(n);
              }
            }}
            onBlur={() => {
              if (parse(draft) === null) {
                setDraft(String(value));
                setError(null);
              }
            }}
          />
          <span className="text-muted-foreground text-sm" aria-hidden="true">
            km
          </span>
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// List editors
// ---------------------------------------------------------------------------

let rowSeq = 0;
const newRowKey = () => `row-${++rowSeq}`;

/** Stable React keys for an editable list whose items have no id. */
function useRowKeys(initialLength: number) {
  const [keys, setKeys] = useState(() => Array.from({ length: initialLength }, newRowKey));
  return {
    keys,
    add: () => {
      const key = newRowKey();
      setKeys((k) => [...k, key]);
      return key;
    },
    remove: (index: number) => setKeys((k) => k.filter((_, i) => i !== index)),
  };
}

const focusSoon = (id: string) => {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
};

function ListShell({
  items,
  emptyText,
  addLabel,
  onAdd,
  children,
}: {
  items: unknown[];
  emptyText: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-4">{children}</ul>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function RowCard({
  title,
  removeLabel,
  onRemove,
  children,
}: {
  title: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium wrap-anywhere">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={removeLabel}
          className="text-muted-foreground hover:text-destructive min-w-10 shrink-0"
        >
          <Trash2Icon aria-hidden="true" />
          <span className="hidden sm:inline">Supprimer</span>
        </Button>
      </div>
      {children}
    </li>
  );
}

const nullable = (text: string) => (text === "" ? null : text);

function ExperienceList({
  idPrefix,
  items,
  onChange,
}: {
  idPrefix: string;
  items: Experience[];
  onChange: (items: Experience[]) => void;
}) {
  const rows = useRowKeys(items.length);
  const set = (index: number, item: Experience) =>
    onChange(items.map((it, i) => (i === index ? item : it)));

  return (
    <ListShell
      items={items}
      emptyText="Aucune expérience pour l'instant."
      addLabel="Ajouter une expérience"
      onAdd={() => {
        const key = rows.add();
        onChange([...items, { title: "", company: null, start: null, end: null, bullets: [] }]);
        focusSoon(`${idPrefix}-${key}-title`);
      }}
    >
      {items.map((item, index) => {
        const key = rows.keys[index];
        const id = (name: string) => `${idPrefix}-${key}-${name}`;
        const name = item.title.trim() || `Expérience ${index + 1}`;
        return (
          <RowCard
            key={key}
            title={name}
            removeLabel={`Supprimer l'expérience ${name}`}
            onRemove={() => {
              rows.remove(index);
              onChange(items.filter((_, i) => i !== index));
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={id("title")} label="Intitulé du poste">
                {(d) => (
                  <Input
                    id={id("title")}
                    value={item.title}
                    onChange={(e) => set(index, { ...item, title: e.target.value })}
                    aria-describedby={d}
                  />
                )}
              </Field>
              <Field id={id("company")} label="Entreprise">
                {(d) => (
                  <Input
                    id={id("company")}
                    value={item.company ?? ""}
                    onChange={(e) => set(index, { ...item, company: nullable(e.target.value) })}
                    aria-describedby={d}
                  />
                )}
              </Field>
              <Field id={id("start")} label="Début">
                {(d) => (
                  <Input
                    id={id("start")}
                    value={item.start ?? ""}
                    onChange={(e) => set(index, { ...item, start: nullable(e.target.value) })}
                    placeholder="ex. sept. 2024"
                    aria-describedby={d}
                  />
                )}
              </Field>
              <Field id={id("end")} label="Fin">
                {(d) => (
                  <Input
                    id={id("end")}
                    value={item.end ?? ""}
                    onChange={(e) => set(index, { ...item, end: nullable(e.target.value) })}
                    placeholder="ex. juin 2025 ou aujourd'hui"
                    aria-describedby={d}
                  />
                )}
              </Field>
            </div>
            <BulletsField
              id={id("bullets")}
              bullets={item.bullets}
              onChange={(bullets) => set(index, { ...item, bullets })}
            />
          </RowCard>
        );
      })}
    </ListShell>
  );
}

/** One bullet per line. Keeps its own text so blank lines survive while typing. */
function BulletsField({
  id,
  bullets,
  onChange,
}: {
  id: string;
  bullets: string[];
  onChange: (bullets: string[]) => void;
}) {
  const [text, setText] = useState(() => bullets.join("\n"));
  return (
    <Field
      id={id}
      label="Missions et réalisations"
      hint="Une par ligne. Reste factuel : chiffres et résultats réels uniquement."
    >
      {(d) => (
        <Textarea
          id={id}
          value={text}
          rows={3}
          aria-describedby={d}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.split("\n"));
          }}
        />
      )}
    </Field>
  );
}

function EducationList({
  idPrefix,
  items,
  onChange,
}: {
  idPrefix: string;
  items: Education[];
  onChange: (items: Education[]) => void;
}) {
  const rows = useRowKeys(items.length);
  const set = (index: number, item: Education) =>
    onChange(items.map((it, i) => (i === index ? item : it)));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Parcours</h3>
      <ListShell
        items={items}
        emptyText="Aucune formation ajoutée."
        addLabel="Ajouter une formation"
        onAdd={() => {
          const key = rows.add();
          onChange([...items, { degree: "", school: null, start: null, end: null }]);
          focusSoon(`${idPrefix}-${key}-degree`);
        }}
      >
        {items.map((item, index) => {
          const key = rows.keys[index];
          const id = (name: string) => `${idPrefix}-${key}-${name}`;
          const name = item.degree.trim() || `Formation ${index + 1}`;
          return (
            <RowCard
              key={key}
              title={name}
              removeLabel={`Supprimer la formation ${name}`}
              onRemove={() => {
                rows.remove(index);
                onChange(items.filter((_, i) => i !== index));
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={id("degree")} label="Diplôme">
                  {(d) => (
                    <Input
                      id={id("degree")}
                      value={item.degree}
                      onChange={(e) => set(index, { ...item, degree: e.target.value })}
                      aria-describedby={d}
                    />
                  )}
                </Field>
                <Field id={id("school")} label="École">
                  {(d) => (
                    <Input
                      id={id("school")}
                      value={item.school ?? ""}
                      onChange={(e) => set(index, { ...item, school: nullable(e.target.value) })}
                      aria-describedby={d}
                    />
                  )}
                </Field>
                <Field id={id("start")} label="Début">
                  {(d) => (
                    <Input
                      id={id("start")}
                      value={item.start ?? ""}
                      onChange={(e) => set(index, { ...item, start: nullable(e.target.value) })}
                      placeholder="ex. 2023"
                      aria-describedby={d}
                    />
                  )}
                </Field>
                <Field id={id("end")} label="Fin">
                  {(d) => (
                    <Input
                      id={id("end")}
                      value={item.end ?? ""}
                      onChange={(e) => set(index, { ...item, end: nullable(e.target.value) })}
                      placeholder="ex. 2026"
                      aria-describedby={d}
                    />
                  )}
                </Field>
              </div>
            </RowCard>
          );
        })}
      </ListShell>
    </div>
  );
}

const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "Langue maternelle", "Bilingue"];

function LanguageList({
  idPrefix,
  items,
  onChange,
}: {
  idPrefix: string;
  items: Language[];
  onChange: (items: Language[]) => void;
}) {
  const rows = useRowKeys(items.length);
  const levelsListId = `${idPrefix}-levels`;
  const set = (index: number, item: Language) =>
    onChange(items.map((it, i) => (i === index ? item : it)));

  return (
    <>
      <datalist id={levelsListId}>
        {LANGUAGE_LEVELS.map((level) => (
          <option key={level} value={level} />
        ))}
      </datalist>
      <ListShell
        items={items}
        emptyText="Aucune langue ajoutée."
        addLabel="Ajouter une langue"
        onAdd={() => {
          const key = rows.add();
          onChange([...items, { language: "", level: null }]);
          focusSoon(`${idPrefix}-${key}-language`);
        }}
      >
        {items.map((item, index) => {
          const key = rows.keys[index];
          const id = (name: string) => `${idPrefix}-${key}-${name}`;
          const name = item.language.trim() || `Langue ${index + 1}`;
          return (
            <RowCard
              key={key}
              title={name}
              removeLabel={`Supprimer la langue ${name}`}
              onRemove={() => {
                rows.remove(index);
                onChange(items.filter((_, i) => i !== index));
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={id("language")} label="Langue">
                  {(d) => (
                    <Input
                      id={id("language")}
                      value={item.language}
                      onChange={(e) => set(index, { ...item, language: e.target.value })}
                      placeholder="ex. Anglais"
                      aria-describedby={d}
                    />
                  )}
                </Field>
                <Field id={id("level")} label="Niveau" hint="ex. B2, C1, courant.">
                  {(d) => (
                    <Input
                      id={id("level")}
                      value={item.level ?? ""}
                      onChange={(e) => set(index, { ...item, level: nullable(e.target.value) })}
                      list={levelsListId}
                      aria-describedby={d}
                    />
                  )}
                </Field>
              </div>
            </RowCard>
          );
        })}
      </ListShell>
    </>
  );
}
