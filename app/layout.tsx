import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family for the whole product. The width axis gives the landing its
// widened display voice while the app stays at normal width (see DESIGN.md).
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute URLs for Open Graph images and canonical links (Vercel falls back to its own URL).
  metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
  title: "Spontané",
  description:
    "Envoie 20 candidatures spontanées ciblées en moins de 15 minutes, puis suis les réponses sans rien saisir.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) work (sticky bars above the iPhone home indicator).
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1226" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${archivo.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
