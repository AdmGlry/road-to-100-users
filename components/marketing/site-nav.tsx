"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { NAV_LINKS } from "@/components/marketing/content";
import { Logo } from "@/components/marketing/logo";
import { cn } from "@/lib/utils";

/** Menu links arrive 60ms apart, the whole sequence capped at 400ms. */
const STAGGER_MS = 60;
const STAGGER_CAP_MS = 400;

/**
 * Floating, blurred navigation of the landing (DESIGN.md "Landing"). The
 * section in view is marked as current. On phones the menu opens as a full
 * height panel whose links rise in one after another.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Current section: the one crossing the upper third of the viewport.
  useEffect(() => {
    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!sections.length || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id);
          else setCurrent((prev) => (prev === entry.target.id ? null : prev));
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    firstLinkRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const desktop = window.matchMedia("(min-width: 48rem)");
    const onResize = () => {
      if (desktop.matches) close(false);
    };
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      root.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [open, close]);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <nav
          aria-label="Navigation principale"
          className="bg-background/70 pointer-events-auto flex items-center gap-2 rounded-full border p-2 backdrop-blur-xl"
        >
          <Link
            href="/"
            className="hover:bg-raised flex h-10 items-center gap-2 rounded-full px-3 text-base font-semibold transition-colors duration-300 ease-(--ease-landing)"
          >
            <Logo className="size-6" />
            Spontané
          </Link>
          <ul className="hidden items-center md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={link.href}
                  aria-current={current === link.id ? "true" : undefined}
                  className={cn(
                    "flex h-10 items-center rounded-full px-3 text-sm font-medium transition-colors duration-300 ease-(--ease-landing)",
                    current === link.id
                      ? "bg-raised text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <Link
            href="/login"
            className="bg-raised hover:bg-border flex h-10 items-center rounded-full px-3 text-sm font-semibold transition-[background-color,scale] duration-300 ease-(--ease-landing) active:scale-[0.98]"
          >
            Se connecter
          </Link>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setOpen((value) => !value)}
            className="hover:bg-raised relative flex size-10 items-center justify-center rounded-full transition-colors duration-300 ease-(--ease-landing) md:hidden"
          >
            <span
              aria-hidden="true"
              className={cn(
                "bg-foreground absolute h-0.5 w-4 rounded-full transition-transform duration-500 ease-(--ease-landing)",
                open ? "rotate-45" : "-translate-y-1",
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                "bg-foreground absolute h-0.5 w-4 rounded-full transition-transform duration-500 ease-(--ease-landing)",
                open ? "-rotate-45" : "translate-y-1",
              )}
            />
          </button>
        </nav>
      </div>

      <div
        id="menu-mobile"
        inert={!open}
        className={cn(
          "bg-background/95 fixed inset-0 z-40 flex flex-col px-4 pt-24 pb-8 backdrop-blur-2xl transition-opacity duration-300 ease-(--ease-landing) md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ul className="flex flex-col gap-2">
          {NAV_LINKS.map((link, index) => (
            <li
              key={link.id}
              style={{
                transitionDelay: open ? `${Math.min(index * STAGGER_MS, STAGGER_CAP_MS)}ms` : "0ms",
              }}
              className={cn(
                "transition-[opacity,translate] duration-500 ease-(--ease-landing)",
                open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
              )}
            >
              <a
                ref={index === 0 ? firstLinkRef : undefined}
                href={link.href}
                onClick={() => close(false)}
                className="flex h-12 items-center text-3xl font-semibold tracking-tight"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div
          style={{
            transitionDelay: open
              ? `${Math.min(NAV_LINKS.length * STAGGER_MS, STAGGER_CAP_MS)}ms`
              : "0ms",
          }}
          className={cn(
            "mt-auto transition-[opacity,translate] duration-500 ease-(--ease-landing)",
            open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
          )}
        >
          <Link
            href="/login"
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex w-full items-center justify-center rounded-xl px-3 py-2 text-base font-semibold transition-[background-color,scale] duration-300 ease-(--ease-landing) active:scale-[0.98]"
          >
            Commencer avec Google
          </Link>
        </div>
      </div>
    </>
  );
}
