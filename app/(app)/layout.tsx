import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOutIcon } from "lucide-react";
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
      <header className="bg-card border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 px-4 sm:px-6 md:h-16 md:flex-nowrap">
          <Link
            href="/dashboard"
            className="font-display -mx-1 inline-flex h-14 items-center rounded-sm px-1 text-lg md:h-10"
          >
            Spontané
          </Link>
          <div className="order-last -mx-4 w-[calc(100%+2rem)] border-t px-1 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-3 md:order-none md:mx-0 md:w-auto md:flex-1 md:border-t-0 md:px-0">
            <AppNav />
          </div>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-6 pb-12 sm:px-6 md:pt-10">
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
      <span
        className="text-muted-foreground hidden max-w-48 truncate text-sm xl:inline"
        title={user.email}
      >
        {user.email}
      </span>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="ghost" size="sm" aria-label="Se déconnecter">
          <LogOutIcon aria-hidden="true" />
          <span className="hidden sm:inline md:hidden lg:inline">Se déconnecter</span>
        </Button>
      </form>
    </div>
  );
}
