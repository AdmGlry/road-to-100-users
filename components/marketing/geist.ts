import { Geist } from "next/font/google";

// The landing's single typeface (DESIGN.md "Landing"). The app keeps Archivo.
export const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
