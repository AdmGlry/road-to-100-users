"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { ConfidenceBadge } from "@/components/review/confidence-badge";
import { contactName, looksLikeEmail, SOURCE_LABELS } from "@/components/review/review-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Contact } from "@/lib/hunter/application-types";
import { cn } from "@/lib/utils";

export type ContactChoice =
  { contactId: string } | { email: string; first_name?: string; last_name?: string };

/**
 * "Changer de contact": pick another stored candidate of the company, or
 * type an address (saved as source user_input, confidence high).
 */
export function ContactPicker({
  contacts,
  currentId,
  companyName,
  approved,
  pending,
  onChoose,
  onCancel,
}: {
  contacts: Contact[];
  currentId: string | null;
  companyName: string;
  approved: boolean;
  pending: boolean;
  onChoose: (choice: ContactChoice) => void;
  /** Absent when there is no recipient yet (the picker cannot be closed). */
  onCancel?: () => void;
}) {
  const uid = useId();
  const others = contacts.filter((c) => c.id !== currentId);
  const [selected, setSelected] = useState<string | null>(others[0]?.id ?? null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setEmailError("Saisis une adresse e-mail complète, par exemple prenom.nom@entreprise.fr.");
      return;
    }
    setEmailError(null);
    onChoose({
      email: email.trim(),
      first_name: firstName.trim() || undefined,
      last_name: lastName.trim() || undefined,
    });
  };

  return (
    <div className="motion-enter bg-muted/40 flex flex-col gap-4 rounded-lg border p-3 sm:p-4">
      {others.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-medium">Autres adresses trouvées</legend>
          {others.map((c) => {
            const name = contactName(c);
            return (
              <label
                key={c.id}
                className={cn(
                  "bg-card flex min-h-10 cursor-pointer items-start gap-3 rounded-md border p-2.5 text-sm",
                  selected === c.id && "border-primary",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-contact`}
                  value={c.id}
                  checked={selected === c.id}
                  onChange={() => setSelected(c.id)}
                  className="accent-primary focus-visible:outline-ring mt-0.5 size-[1.125rem] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium wrap-anywhere" translate="no">
                    {c.email}
                  </span>
                  {(name || c.role) && (
                    <span className="text-muted-foreground wrap-anywhere">
                      {[name, c.role].filter(Boolean).join(", ")}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-2">
                    <ConfidenceBadge confidence={c.confidence} />
                    <span className="text-muted-foreground text-xs">{SOURCE_LABELS[c.source]}</span>
                  </span>
                </span>
              </label>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-fit"
            disabled={pending || !selected}
            onClick={() => selected && onChoose({ contactId: selected })}
          >
            {pending && <LoaderCircleIcon aria-hidden="true" className="animate-spin" />}
            Utiliser cette adresse
          </Button>
        </fieldset>
      )}

      <form onSubmit={submitManual} className="flex flex-col gap-3" noValidate>
        <p className="text-sm font-medium">
          {others.length > 0 ? "Ou saisis une adresse" : "Saisis l'adresse du destinataire"}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-email`} className="leading-snug wrap-anywhere">
            Adresse e-mail chez {companyName}
          </Label>
          <Input
            id={`${uid}-email`}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${uid}-email-error` : undefined}
            disabled={pending}
            required
          />
          {emailError && (
            <p id={`${uid}-email-error`} role="alert" className="text-destructive text-sm">
              {emailError}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${uid}-first`}>Prénom (facultatif)</Label>
            <Input
              id={`${uid}-first`}
              autoComplete="off"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={80}
              disabled={pending}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${uid}-last`}>Nom (facultatif)</Label>
            <Input
              id={`${uid}-last`}
              autoComplete="off"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={80}
              disabled={pending}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          La formule « Bonjour … » du mail s&apos;adapte au nouveau destinataire.
          {approved && " Le mail repassera en brouillon : tu devras le valider à nouveau."}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Annuler
            </Button>
          )}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending && <LoaderCircleIcon aria-hidden="true" className="animate-spin" />}
            Enregistrer ce destinataire
          </Button>
        </div>
      </form>
    </div>
  );
}
