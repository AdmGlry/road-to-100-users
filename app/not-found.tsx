import Link from "next/link";

import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";

import { geist } from "@/components/marketing/geist";
import { Logo } from "@/components/marketing/logo";

export default function NotFound() {
  return (
    <main
      className={`${geist.variable} landing flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center`}
    >
      <Logo className="size-10" />
      <h1 className="text-heading-gradient max-w-[680px] pb-2 text-4xl font-semibold tracking-tight sm:text-5xl">
        Cette page n&apos;existe pas
      </h1>
      <p className="text-muted-foreground max-w-[680px] text-lg">
        Le lien est sans doute incomplet, ou la page a changé de place.
      </p>
      <Link
        href="/"
        className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-2 rounded-xl px-3 py-2 text-base font-semibold transition-[background-color,scale] duration-300 ease-(--ease-landing) active:scale-[0.98]"
      >
        <ArrowLeftIcon weight="bold" className="size-5" aria-hidden="true" />
        Revenir à l&apos;accueil
      </Link>
    </main>
  );
}
