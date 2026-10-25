"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/profile", label: "Profil" },
  { href: "/hunter", label: "Chasseur" },
  { href: "/tracker", label: "Suivi" },
  { href: "/settings", label: "Paramètres" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-8 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
                  active
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
