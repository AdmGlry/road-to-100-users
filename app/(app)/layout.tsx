import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppNav } from "@/components/app/app-nav";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Signed-in area. proxy.ts already redirects anonymous visitors; the session
 * is checked again here (defense in depth). With Cache Components the
 * session read must sit behind <Suspense>, so the header chrome prerenders and
 * the user-dependent parts stream in.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Spontané
          </Link>
          <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
            <AppNav />
          </div>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Chargement…</p>}>
          <RequireUser>{children}</RequireUser>
        </Suspense>
      </main>
    </div>
  );
}

async function RequireUser({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return children;
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground max-w-48 truncate text-sm" title={user.email}>
        {user.email}
      </span>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" size="sm">
          Se déconnecter
        </Button>
      </form>
    </div>
  );
}
