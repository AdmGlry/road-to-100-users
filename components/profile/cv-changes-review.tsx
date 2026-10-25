"use client";

import { useEffect, useId, useRef, useState } from "react";

import { formatFieldValue } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { FieldChange } from "@/lib/profile/service";

/**
 * Modal shown after "Remplacer mon CV": one checkbox per changed field,
 * current vs proposed values. Uses the native <dialog> element (focus
 * trap, Escape and inert background for free). Escape = keep the profile.
 */
export function CvChangesReview({
  changes,
  pending,
  error,
  onApply,
  onDismiss,
}: {
  changes: FieldChange[];
  pending: boolean;
  error: string | null;
  onApply: (acceptedFields: string[]) => void;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(changes.filter((c) => c.defaultAccept).map((c) => c.field)),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // When the list overflows, Chrome would focus the scroll container
      // (and draw the focus ring across the dialog): start on the first choice.
      dialog.querySelector<HTMLInputElement>("input[type=checkbox]")?.focus();
    }
    return () => dialog?.close();
  }, []);

  const toggle = (field: string, checked: boolean) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onDismiss();
      }}
      // True overlay: the one place an (ink-tinted, offset) shadow is allowed.
      className="motion-dialog bg-background text-foreground dark:bg-card m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl rounded-xl border p-0 shadow-[0_16px_48px_-12px_rgb(23_27_52/0.35)] backdrop:bg-[rgb(15_18_38/0.55)] dark:backdrop:bg-black/75"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex flex-col gap-1.5 border-b p-4 sm:p-6">
          <h2 id={titleId} className="text-lg font-semibold">
            Changements trouvés dans ton nouveau CV
          </h2>
          <p id={descId} className="text-muted-foreground text-sm">
            Coche ce que tu veux reprendre du nouveau CV. Ce que tu ne coches pas reste tel quel, y
            compris tes corrections.
          </p>
        </div>

        <ul className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {changes.map((change) => {
            const checkboxId = `${titleId}-${change.field}`;
            const current = formatFieldValue(change.field, change.current);
            const proposed = formatFieldValue(change.field, change.proposed);
            return (
              <li key={change.field} className="rounded-lg border p-3 sm:p-4">
                {/* Checkbox + field name share one ≥ 40 px tap target. */}
                <label
                  htmlFor={checkboxId}
                  className="-m-1 flex min-h-10 cursor-pointer items-center gap-3 rounded-md p-1 text-sm font-medium select-none"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={accepted.has(change.field)}
                    onChange={(e) => toggle(change.field, e.target.checked)}
                    disabled={pending}
                  />
                  {change.label}
                </label>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:pl-8">
                  <ValueBlock title="Actuel" lines={current} />
                  <ValueBlock title="Dans le nouveau CV" lines={proposed} highlight />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t p-4 sm:p-6">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onDismiss} disabled={pending}>
              Garder mon profil actuel
            </Button>
            <Button
              type="button"
              onClick={() => onApply([...accepted])}
              disabled={pending || accepted.size === 0}
            >
              {pending
                ? "Mise à jour du profil…"
                : accepted.size > 1
                  ? `Reprendre ces ${accepted.size} changements`
                  : accepted.size === 1
                    ? "Reprendre ce changement"
                    : "Reprendre la sélection"}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function ValueBlock({
  title,
  lines,
  highlight = false,
}: {
  title: string;
  lines: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={highlight ? "bg-secondary/60 min-w-0 rounded-md p-2" : "min-w-0 rounded-md p-2"}
    >
      <p className="text-muted-foreground mb-1 text-xs font-medium">{title}</p>
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">(vide)</p>
      ) : lines.length === 1 ? (
        <p className="text-sm wrap-anywhere whitespace-pre-line">{lines[0]}</p>
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {lines.map((line, i) => (
            <li key={i} className="wrap-anywhere">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
