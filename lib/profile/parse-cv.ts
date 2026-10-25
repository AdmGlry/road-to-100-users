/**
 * CV PDF → plain text (SPEC §5.1). SERVER ONLY.
 *
 * Validates the file (PDF magic bytes, 5 MB max) and extracts its text with
 * unpdf. A text shorter than CV_MIN_TEXT_CHARS means the PDF is most likely a
 * scanned image: the student is asked for a text PDF instead.
 * Never logs the CV content.
 */
import { extractText } from "unpdf";

import { CV_MAX_BYTES, CV_MIN_TEXT_CHARS } from "./schema";

export type CvErrorCode = "not_found" | "not_pdf" | "too_large" | "too_short" | "llm_failed";

const USER_MESSAGES: Record<CvErrorCode, string> = {
  not_found: "On ne retrouve pas ton CV. Dépose-le à nouveau (PDF, 5 Mo maximum).",
  not_pdf:
    "Ce fichier n'est pas un PDF lisible. Exporte ton CV en PDF depuis Word, Google Docs ou Canva et réessaie.",
  too_large:
    "Ton CV dépasse 5 Mo. Réduis sa taille (par exemple en compressant les images) et réessaie.",
  too_short:
    "Ton CV semble être une image scannée : on n'arrive pas à lire le texte. Exporte-le en PDF depuis Word, Google Docs ou Canva (PDF texte) et réessaie.",
  llm_failed:
    "On n'a pas réussi à analyser ton CV pour le moment. Réessaie dans quelques instants ou remplis ton profil à la main.",
};

/** Error with a stable `code` and a French message safe to show to the student. */
export class CvError extends Error {
  readonly code: CvErrorCode;
  readonly userMessage: string;

  constructor(code: CvErrorCode, options?: { cause?: unknown }) {
    // The technical message contains only the code, never CV content.
    super(`CV processing failed: ${code}`, options);
    this.name = "CvError";
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True if the bytes start with "%PDF-" (some generators prepend a few bytes: allow up to 1 KB). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let offset = 0; offset <= limit; offset++) {
    if (PDF_MAGIC.every((b, i) => bytes[offset + i] === b)) return true;
  }
  return false;
}

/**
 * Collapses runs of horizontal whitespace, trims every line, keeps at most one
 * blank line between blocks, and trims the whole text.
 */
export function normalizeCvText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Validates a CV PDF and returns its normalised text.
 * Throws CvError("too_large" | "not_pdf" | "too_short").
 */
export async function extractCvText(pdf: Uint8Array): Promise<string> {
  if (pdf.byteLength > CV_MAX_BYTES) throw new CvError("too_large");
  if (!hasPdfMagic(pdf)) throw new CvError("not_pdf");

  let raw: string;
  try {
    // pdf.js may transfer (detach) the buffer it receives: give it a copy.
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    raw = text;
  } catch (cause) {
    throw new CvError("not_pdf", { cause });
  }

  const text = normalizeCvText(raw);
  if (text.length < CV_MIN_TEXT_CHARS) throw new CvError("too_short");
  return text;
}
