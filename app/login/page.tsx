import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Connexion · Spontané",
};

const ERROR_MESSAGES: Record<string, string> = {
  auth: "La connexion avec Google n'a pas abouti. Réessaie.",
};
const GENERIC_ERROR = "Une erreur est survenue pendant la connexion. Réessaie.";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:h-20 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="font-display -mx-1 inline-flex h-10 items-center rounded-sm px-1 text-xl"
        >
          Spontané
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <section
          aria-labelledby="login-title"
          className="bg-card flex w-full max-w-md flex-col gap-6 rounded-2xl border p-6 sm:p-8"
        >
          <div className="flex flex-col gap-2">
            <h1 id="login-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Connexion
            </h1>
            <p className="text-muted-foreground leading-relaxed">
              Connecte-toi avec ton compte Google pour retrouver ton profil et tes candidatures.
            </p>
          </div>
          {/* searchParams is request data: read it behind a boundary (Cache Components). */}
          <Suspense fallback={<GoogleSignInButton next={safeRedirectPath(null)} />}>
            <LoginForm searchParams={searchParams} />
          </Suspense>
          <p className="text-muted-foreground border-t pt-5 text-sm leading-relaxed">
            Cette étape sert seulement à te connecter. L&apos;accès à Gmail te sera demandé plus
            tard, sur un écran qui explique pourquoi.
          </p>
        </section>
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground -mx-1 inline-flex h-10 items-center rounded-sm px-1 text-sm underline underline-offset-4"
        >
          Retour à l&apos;accueil
        </Link>
      </footer>
    </div>
  );
}

async function LoginForm({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? GENERIC_ERROR) : null;

  return (
    <>
      {errorMessage ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2.5 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}
      <GoogleSignInButton next={next} />
    </>
  );
}
