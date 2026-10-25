/**
 * RFC 5322 / MIME message builder for Gmail `users.messages.send` (SPEC §7.6).
 * Pure: no I/O. Output is the base64url-encoded message (Gmail `raw`).
 *
 * Structure:
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain; charset=utf-8 (base64)
 *       text/html; charset=utf-8 (base64)
 *     application/pdf attachment (base64), when given
 *
 * Header values containing CR/LF are rejected (header injection). Non-ASCII
 * subjects and display names use RFC 2047 encoded-words (UTF-8, base64).
 */
import { randomBytes } from "node:crypto";

export type MimeInput = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment?: { filename: string; content: Uint8Array; mimeType: string };
};

export class MimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MimeError";
  }
}

/** Pragmatic address check: one @, no spaces/brackets/quotes, dotted domain. */
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n\0]/.test(value)) throw new MimeError(`Invalid ${field} header value`);
}

function assertEmail(value: string, field: string): void {
  assertHeaderSafe(value, field);
  if (!isValidEmail(value)) throw new MimeError(`Invalid ${field} address`);
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/**
 * RFC 2047 encoded-words, split on character boundaries so each word stays
 * under 75 characters (UTF-8 sequences are never cut).
 */
export function encodeHeaderWord(value: string): string {
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    const next = chunk + ch;
    // "=?UTF-8?B?" + base64 + "?=" ≤ 75 → ≤ 45 bytes of UTF-8 per word.
    if (Buffer.byteLength(next, "utf8") > 45) {
      words.push(chunk);
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

function formatAddress(name: string, email: string): string {
  const trimmed = name.trim();
  if (!trimmed) return email;
  if (isAscii(trimmed)) {
    const quoted = trimmed.replace(/(["\\])/g, "\\$1");
    return `"${quoted}" <${email}>`;
  }
  return `${encodeHeaderWord(trimmed)} <${email}>`;
}

/** Base64 wrapped at 76 characters (RFC 2045). */
function base64Lines(data: Uint8Array | string): string {
  const b64 = (typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)).toString(
    "base64",
  );
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function boundary(tag: string): string {
  return `=_spontane_${tag}_${randomBytes(12).toString("hex")}`;
}

/** Builds the message and returns it base64url-encoded (Gmail `raw`). */
export function buildMimeMessage(input: MimeInput): string {
  assertEmail(input.from.email, "From");
  assertHeaderSafe(input.from.name, "From");
  assertEmail(input.to, "To");
  assertHeaderSafe(input.subject, "Subject");
  if (input.attachment) {
    assertHeaderSafe(input.attachment.filename, "filename");
    assertHeaderSafe(input.attachment.mimeType, "Content-Type");
    if (!/^[\w.-]+\/[\w.+-]+$/.test(input.attachment.mimeType)) {
      throw new MimeError("Invalid attachment type");
    }
  }

  const mixed = boundary("mixed");
  const alt = boundary("alt");
  const lines: string[] = [
    `From: ${formatAddress(input.from.name, input.from.email)}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.text.replace(/\r?\n/g, "\r\n")),
    `--${alt}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${alt}--`,
  ];

  if (input.attachment) {
    // Filenames are ASCII (cvFilename); escape quotes defensively.
    const name = input.attachment.filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/(["\\])/g, "\\$1");
    lines.push(
      `--${mixed}`,
      `Content-Type: ${input.attachment.mimeType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(input.attachment.content),
    );
  }
  lines.push(`--${mixed}--`, "");

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text → simple HTML: escaped, blank lines → paragraphs, newlines → <br>. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#171b34">${paragraphs.join("")}</body></html>`;
}

function asciiPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `CV_Prenom_Nom.pdf` (SPEC §7.6): accents stripped, ASCII only, words
 * joined with "_" (compound names keep their hyphen). Fallback `CV.pdf`.
 */
export function cvFilename(fullName: string | null): string {
  const parts = (fullName ?? "")
    .trim()
    .split(/\s+/)
    .map(asciiPart)
    .filter((p) => p.length > 0)
    .map((p) =>
      p
        .split("-")
        // "DUPONT" → "Dupont"; mixed case such as "McCarthy" is kept.
        .map((w) => {
          const rest = w === w.toUpperCase() ? w.slice(1).toLowerCase() : w.slice(1);
          return w.charAt(0).toUpperCase() + rest;
        })
        .join("-"),
    );
  if (parts.length === 0) return "CV.pdf";
  const name = parts
    .join("_")
    .slice(0, 80)
    .replace(/[-_]+$/, "");
  return `CV_${name}.pdf`;
}
