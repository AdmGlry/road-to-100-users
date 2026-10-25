"use client";

import { CheckCircle2Icon, FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";

import { analyzeCv, applyCvChangesAction } from "@/app/(app)/profile/actions";
import { CvChangesReview } from "@/components/profile/cv-changes-review";
import { checkCvFile, hasPdfSignature } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import { CV_BUCKET, CV_MAX_BYTES, cvStoragePath, type EditableProfile } from "@/lib/profile/schema";
import type { FieldChange } from "@/lib/profile/service";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "analyzing" }
  | { kind: "review"; changes: FieldChange[]; applying: boolean; error: string | null }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const NETWORK_ERROR = "Connexion perdue. Vérifie ta connexion internet puis réessaie.";

/**
 * CV import (SPEC §5.1). The PDF goes straight from the browser to the
 * private Supabase Storage bucket (RLS: only the owner can write their
 * folder), so it never passes through a Vercel function (4.5 MB body cap).
 * The server action `analyzeCv` then reads it from Storage.
 */
export function CvUpload({
  userId,
  hasCv,
  onUploaded,
  onBeforeAnalyze,
  onBusyChange,
  onProfileUpdated,
}: {
  userId: string;
  hasCv: boolean;
  onUploaded: () => void;
  /** Saves pending form edits; resolves to false if that failed. */
  onBeforeAnalyze: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onProfileUpdated: (profile: EditableProfile, savedAt: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const busy = phase.kind === "uploading" || phase.kind === "analyzing" || phase.kind === "review";

  const finish = (next: Phase) => {
    setPhase(next);
    onBusyChange(false);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    const invalid = checkCvFile(file, CV_MAX_BYTES);
    if (invalid) return setPhase({ kind: "error", message: invalid });
    try {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (!hasPdfSignature(header)) {
        return setPhase({
          kind: "error",
          message: "Ce fichier n'est pas un PDF valide. Exporte ton CV en PDF puis réessaie.",
        });
      }
    } catch {
      return setPhase({ kind: "error", message: "Impossible de lire ce fichier. Réessaie." });
    }

    setPhase({ kind: "uploading" });
    onBusyChange(true);

    if (!(await onBeforeAnalyze())) {
      return finish({
        kind: "error",
        message:
          "Tes dernières modifications n'ont pas pu être enregistrées. Réessaie avant d'importer ton CV.",
      });
    }

    try {
      const supabase = createClient();
      const { error } = await supabase.storage.from(CV_BUCKET).upload(cvStoragePath(userId), file, {
        upsert: true,
        contentType: "application/pdf",
        cacheControl: "0",
      });
      if (error) {
        return finish({
          kind: "error",
          message: "L'envoi du CV a échoué. Vérifie ta connexion puis réessaie.",
        });
      }
    } catch {
      return finish({ kind: "error", message: NETWORK_ERROR });
    }
    onUploaded();

    setPhase({ kind: "analyzing" });
    try {
      const result = await analyzeCv();
      if (result.status === "error") return finish({ kind: "error", message: result.message });
      if (result.status === "applied") {
        onProfileUpdated(result.profile, result.savedAt);
        return finish({
          kind: "done",
          message:
            "Ton profil a été pré-rempli à partir de ton CV. Vérifie chaque champ ci-dessous.",
        });
      }
      if (result.changes.length === 0) {
        return finish({
          kind: "done",
          message: "CV remplacé. Il ne contient rien de nouveau par rapport à ton profil.",
        });
      }
      setPhase({ kind: "review", changes: result.changes, applying: false, error: null });
    } catch {
      finish({ kind: "error", message: NETWORK_ERROR });
    }
  };

  const applySelection = async (changes: FieldChange[], acceptedFields: string[]) => {
    setPhase({ kind: "review", changes, applying: true, error: null });
    try {
      const result = await applyCvChangesAction(changes, acceptedFields);
      if (!result.ok) {
        return setPhase({ kind: "review", changes, applying: false, error: result.message });
      }
      onProfileUpdated(result.profile, result.savedAt);
      finish({
        kind: "done",
        message: "Les changements sélectionnés ont été appliqués. Vérifie ton profil ci-dessous.",
      });
    } catch {
      setPhase({ kind: "review", changes, applying: false, error: NETWORK_ERROR });
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        <FileUpIcon aria-hidden="true" className="text-muted-foreground size-8" />
        <Button
          type="button"
          size={hasCv ? "default" : "lg"}
          variant={hasCv ? "outline" : "default"}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-describedby={hintId}
        >
          {hasCv ? "Remplacer mon CV" : "Importer mon CV"}
        </Button>
        <p id={hintId} className="text-muted-foreground text-xs">
          <span className="hidden sm:inline">Ou glisse-dépose ton fichier ici. </span>
          PDF uniquement, 5 Mo maximum.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </div>

      <div aria-live="polite" role="status" className="text-sm empty:hidden">
        {phase.kind === "uploading" && <Progress label="Envoi du CV…" />}
        {phase.kind === "analyzing" && (
          <Progress label="Lecture du CV par l'IA… Cela prend en général 10 à 20 secondes." />
        )}
        {phase.kind === "done" && (
          <p className="inline-flex items-start gap-2">
            <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {phase.message}
          </p>
        )}
      </div>
      {phase.kind === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {phase.message}
        </p>
      )}

      {phase.kind === "review" && (
        <CvChangesReview
          changes={phase.changes}
          pending={phase.applying}
          error={phase.error}
          onApply={(accepted) => void applySelection(phase.changes, accepted)}
          onDismiss={() =>
            finish({
              kind: "done",
              message: "CV remplacé. Ton profil actuel a été conservé tel quel.",
            })
          }
        />
      )}
    </div>
  );
}

function Progress({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="inline-flex items-center gap-2">
        <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
        {label}
      </p>
      <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full" aria-hidden="true">
        <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
      </div>
    </div>
  );
}
