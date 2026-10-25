"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseIcon,
  RadarIcon,
  SettingsIcon,
  SquareKanbanIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Accueil", icon: HouseIcon },
  { href: "/profile", label: "Profil", icon: UserRoundIcon },
  { href: "/hunter", label: "Chasseur", icon: RadarIcon },
  { href: "/tracker", label: "Suivi", icon: SquareKanbanIcon },
  { href: "/settings", label: "Paramètres", icon: SettingsIcon },
];

/**
 * Main navigation. Phone: five equal columns (icon above label), no
 * horizontal scroll, 48px targets. From `md`: an inline row of text links
 * with an ink underline on the current page.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale">
      <ul className="grid grid-cols-5 md:flex md:gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium transition-colors duration-(--duration-fast)",
                  "md:h-10 md:flex-row md:gap-2 md:px-3 md:text-sm",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors md:after:-bottom-3",
                  active
                    ? "text-primary after:bg-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent after:bg-transparent",
                )}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0 md:hidden lg:block lg:size-4" />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
