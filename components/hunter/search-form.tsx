"use client";

import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import {
  clampRadius,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  SIZE_OPTIONS,
  type CompanySize,
} from "@/components/hunter/hunter-utils";
import { CONTRACT_TYPE_LABELS } from "@/components/profile/profile-utils";
import { TagInput } from "@/components/profile/tag-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { hunterSearchParamsSchema, type HunterSearchParams } from "@/lib/hunter/types";
import { CONTRACT_TYPES, type ContractType } from "@/lib/profile/schema";
import { cn } from "@/lib/utils";

/**
 * Search criteria (SPEC §7.1), prefilled from the profile. Editing here
 * does not change the profile: the criteria are stored with the search.
 */
export function SearchForm({
  initialParams,
  onSubmit,
  busy = false,
  disabled = false,
  submitLabel = "Lancer la recherche",
}: {
  initialParams: HunterSearchParams;
  onSubmit: (params: HunterSearchParams) => void;
  busy?: boolean;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const [params, setParams] = useState<HunterSearchParams>(initialParams);
  const [radiusDraft, setRadiusDraft] = useState(String(initialParams.radius_km));
  const [errors, setErrors] = useState<{ roles?: string; city?: string }>({});

  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const update = <K extends keyof HunterSearchParams>(key: K, value: HunterSearchParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  const setRadius = (value: number) => {
    const km = clampRadius(value);
    update("radius_km", km);
    setRadiusDraft(String(km));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const candidate = { ...params, radius_km: clampRadius(params.radius_km) };
    const parsed = hunterSearchParamsSchema.safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === "city" ? "city" : "roles";
        if (field === "city") nextErrors.city ??= issue.message;
        else
          nextErrors.roles ??=
            issue.code === "custom"
              ? "Ajoute au moins un poste ou un secteur visé."
              : "Un des postes ou secteurs n'est pas valide (100 caractères max).";
      }
      setErrors(nextErrors);
      document.getElementById(fid(nextErrors.roles ? "roles" : "city"))?.focus();
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Critères de recherche"
      className="flex flex-col gap-5"
    >
      <fieldset disabled={disabled || busy} className="flex min-w-0 flex-col gap-5">
        <legend className="sr-only">Critères de recherche</legend>

        {/* Larger tap targets for TagInput (its field and × buttons). */}
        <div className="grid gap-5 lg:grid-cols-2 [&_input[type=text]]:h-9 [&_li_button]:size-8">
          <Field
            id={fid("roles")}
            label="Postes visés"
            hint="ex. Business Analyst, Chef de projet MOA."
            error={errors.roles}
          >
            {(describedBy) => (
              <TagInput
                id={fid("roles")}
                value={params.roles}
                onChange={(v) => {
                  update("roles", v);
                  if (v.length > 0) setErrors((e) => ({ ...e, roles: undefined }));
                }}
                describedBy={describedBy}
                placeholder="Ajouter un poste"
                max={10}
              />
            )}
          </Field>

          <Field
            id={fid("sectors")}
            label="Secteurs visés"
            hint="Facultatif si tu as indiqué un poste. Laisse vide si tout t'intéresse."
          >
            {(describedBy) => (
              <TagInput
                id={fid("sectors")}
                value={params.sectors}
                onChange={(v) => update("sectors", v)}
                describedBy={describedBy}
                placeholder="Ajouter un secteur"
                max={10}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field id={fid("city")} label="Ville" error={errors.city}>
            {(describedBy) => (
              <Input
                id={fid("city")}
                value={params.city}
                onChange={(e) => {
                  update("city", e.target.value);
                  if (e.target.value.trim()) setErrors((er) => ({ ...er, city: undefined }));
                }}
                autoComplete="address-level2"
                aria-invalid={errors.city ? true : undefined}
                aria-describedby={describedBy}
                placeholder="ex. Nantes"
                maxLength={100}
                className="h-10"
              />
            )}
          </Field>

          <Field
            id={fid("radius")}
            label="Rayon"
            hint={`Autour de la ville, de ${RADIUS_MIN_KM} à ${RADIUS_MAX_KM} km.`}
          >
            {(describedBy) => (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={RADIUS_MIN_KM}
                  max={RADIUS_MAX_KM}
                  step={5}
                  value={params.radius_km}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  aria-label="Rayon en kilomètres (curseur)"
                  aria-valuetext={`${params.radius_km} km`}
                  className="accent-primary h-10 min-w-0 flex-1 cursor-pointer"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    id={fid("radius")}
                    type="number"
                    inputMode="numeric"
                    min={RADIUS_MIN_KM}
                    max={RADIUS_MAX_KM}
                    step={5}
                    value={radiusDraft}
                    aria-describedby={describedBy}
                    className="h-10 w-20"
                    onChange={(e) => {
                      setRadiusDraft(e.target.value);
                      const n = Number.parseInt(e.target.value, 10);
                      if (n >= RADIUS_MIN_KM && n <= RADIUS_MAX_KM) update("radius_km", n);
                    }}
                    onBlur={() => setRadius(Number.parseInt(radiusDraft, 10))}
                  />
                  <span className="text-muted-foreground text-sm" aria-hidden="true">
                    km
                  </span>
                </div>
              </div>
            )}
          </Field>

          <Field id={fid("contract")} label="Type de contrat">
            {(describedBy) => (
              <NativeSelect
                id={fid("contract")}
                value={params.contract_type ?? ""}
                onChange={(e) =>
                  update(
                    "contract_type",
                    e.target.value === "" ? null : (e.target.value as ContractType),
                  )
                }
                aria-describedby={describedBy}
                className="h-10"
              >
                <option value="">Peu importe</option>
                {CONTRACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CONTRACT_TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field id={fid("size")} label="Taille d'entreprise">
            {(describedBy) => (
              <NativeSelect
                id={fid("size")}
                value={params.size}
                onChange={(e) => update("size", e.target.value as CompanySize)}
                aria-describedby={describedBy}
                className="h-10"
              >
                {SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" size="lg" disabled={disabled || busy} className="w-full sm:w-auto">
          {busy ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <SearchIcon aria-hidden="true" />
          )}
          {busy ? "Lancement…" : submitLabel}
        </Button>
        <p className="text-muted-foreground text-xs">
          Compte 1 à 3 minutes. Tu peux quitter la page, la recherche continue.
        </p>
      </div>
    </form>
  );
}

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
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
