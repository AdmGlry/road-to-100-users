import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            <h1>Connexion</h1>
          </CardTitle>
          <CardDescription>
            Connecte-toi avec ton compte Google pour accéder à Spontané.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* searchParams is request data: read it behind a boundary (Cache Components). */}
          <Suspense fallback={<GoogleSignInButton next={safeRedirectPath(null)} />}>
            <LoginForm searchParams={searchParams} />
          </Suspense>
          <p className="text-muted-foreground text-center text-xs">
            <Link href="/" className="hover:text-foreground underline underline-offset-4">
              Retour à l&apos;accueil
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
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
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}
      <GoogleSignInButton next={next} />
    </>
  );
}
