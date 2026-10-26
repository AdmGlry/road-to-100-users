import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { CONTAINER } from "@/components/marketing/container";
import { NAV_LINKS } from "@/components/marketing/content";
import { geist } from "@/components/marketing/geist";
import { Logo } from "@/components/marketing/logo";
import { RevealObserver } from "@/components/marketing/reveal-observer";
import { SiteNav } from "@/components/marketing/site-nav";

export const metadata: Metadata = {
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Spontané",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`${geist.variable} landing flex flex-1 flex-col`}>
      <a
        href="#contenu"
        className="bg-primary text-primary-foreground fixed top-4 left-4 z-[60] flex h-10 -translate-y-24 items-center rounded-full px-3 text-sm font-semibold focus-visible:translate-y-0"
      >
        Aller au contenu
      </a>
      <SiteNav />
      <main id="contenu" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer id="pied" className="border-t">
      <div
        className={`${CONTAINER} text-muted-foreground flex flex-col gap-8 py-12 text-sm sm:flex-row sm:items-start sm:justify-between`}
      >
        <div className="flex flex-col gap-2">
          <Link
            href="/"
            className="text-foreground flex h-10 items-center gap-2 self-start text-base font-semibold"
          >
            <Logo className="size-6" />
            Spontané
          </Link>
          <p>La candidature spontanée pour ton alternance ou ton stage. En bêta fermée.</p>
        </div>
        <nav aria-label="Pied de page" className="grid grid-cols-2 gap-x-12 gap-y-2 sm:gap-x-16">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={`/${link.href}`}
                  className="hover:text-foreground flex h-10 items-center transition-colors duration-300 ease-(--ease-landing)"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/login"
                className="hover:text-foreground flex h-10 items-center transition-colors duration-300 ease-(--ease-landing)"
              >
                Se connecter
              </Link>
            </li>
          </ul>
          <ul className="flex flex-col">
            {/* Pages written with the Sprint 5 RGPD work: shown disabled until then. */}
            <li>
              <span aria-disabled="true" className="flex h-10 items-center">
                Confidentialité (bientôt)
              </span>
            </li>
            <li>
              <span aria-disabled="true" className="flex h-10 items-center">
                Conditions (bientôt)
              </span>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
