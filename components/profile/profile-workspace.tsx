"use client";

import { useRef, useState } from "react";

import { CvUpload } from "@/components/profile/cv-upload";
import { ProfileForm, type ProfileFormHandle } from "@/components/profile/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EditableProfile } from "@/lib/profile/schema";
import { cn } from "@/lib/utils";

/**
 * Client side of the profile page: CV import card on top, editable form
 * below. While a CV is uploaded/analyzed the form is paused (its pending
 * edits are saved first), and it is re-mounted with the new values once
 * the CV data has been applied.
 */
export function ProfileWorkspace({
  userId,
  initialProfile,
  hasCv: initialHasCv,
  updatedAt,
}: {
  userId: string;
  initialProfile: EditableProfile;
  hasCv: boolean;
  updatedAt: string | null;
}) {
  const formRef = useRef<ProfileFormHandle>(null);
  const [busy, setBusy] = useState(false);
  const [hasCv, setHasCv] = useState(initialHasCv);
  const [form, setForm] = useState({
    version: 0,
    profile: initialProfile,
    savedAt: updatedAt,
  });

  return (
    <div className="flex flex-col gap-6">
      <Card className={cn(!hasCv && "border-primary/40 shadow-md")}>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{hasCv ? "Ton CV" : "Commence par ton CV"}</h2>
          </CardTitle>
          <CardDescription>
            On lit ton CV pour pré-remplir ton profil. Tu peux tout corriger. Rien n&apos;est
            inventé : vérifie quand même chaque champ.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CvUpload
            userId={userId}
            hasCv={hasCv}
            onUploaded={() => setHasCv(true)}
            onBeforeAnalyze={() => formRef.current?.flush() ?? Promise.resolve(true)}
            onBusyChange={setBusy}
            onProfileUpdated={(profile, savedAt) =>
              setForm((f) => ({ version: f.version + 1, profile, savedAt }))
            }
          />
          {!hasCv && (
            <p className="text-muted-foreground text-sm">
              Pas de CV sous la main ? Tu peux aussi remplir ton profil à la main ci-dessous.
            </p>
          )}
        </CardContent>
      </Card>

      {busy && (
        <p className="text-muted-foreground text-sm">
          Le formulaire est en pause pendant la lecture de ton CV.
        </p>
      )}
      <ProfileForm
        key={form.version}
        ref={formRef}
        initialProfile={form.profile}
        initialSavedAt={form.savedAt}
        disabled={busy}
      />
    </div>
  );
}
