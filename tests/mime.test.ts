import { describe, expect, it } from "vitest";

import {
  buildMimeMessage,
  cvFilename,
  encodeHeaderWord,
  isValidEmail,
  MimeError,
  textToHtml,
  type MimeInput,
} from "@/lib/hunter/mime";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 255]);

function input(overrides: Partial<MimeInput> = {}): MimeInput {
  return {
    from: { name: "Léa Martin", email: "lea.martin@gmail.com" },
    to: "recrutement@acme.fr",
    subject: "Alternance Business Analyst – sept. 2027 – Acme",
    text: "Bonjour,\n\nJe m'appelle Léa.\nMerci !",
    html: textToHtml("Bonjour,\n\nJe m'appelle Léa.\nMerci !"),
    attachment: { filename: "CV_Lea_Martin.pdf", content: PDF, mimeType: "application/pdf" },
    ...overrides,
  };
}

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

/** Decodes RFC 2047 encoded-words (UTF-8, B). */
const decodeWords = (s: string) =>
  s
    .replace(/\r\n /g, "")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64: string) =>
      Buffer.from(b64, "base64").toString("utf8"),
    );

function part(message: string, contentType: string): string {
  const idx = message.indexOf(`Content-Type: ${contentType}`);
  expect(idx).toBeGreaterThan(-1);
  const start = message.indexOf("\r\n\r\n", idx) + 4;
  const end = message.indexOf("\r\n--", start);
  return Buffer.from(message.slice(start, end).replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("buildMimeMessage", () => {
  it("builds multipart/mixed > alternative + PDF attachment, base64url encoded", () => {
    const raw = buildMimeMessage(input());
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const msg = decode(raw);

    expect(msg).toContain("To: recrutement@acme.fr\r\n");
    expect(msg).toContain("MIME-Version: 1.0\r\n");
    expect(msg).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"/);
    expect(msg).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"/);
    expect(part(msg, "text/plain; charset=utf-8")).toBe(
      "Bonjour,\r\n\r\nJe m'appelle Léa.\r\nMerci !",
    );
    expect(part(msg, "text/html; charset=utf-8")).toContain("<p>Je m&#39;appelle Léa.<br>Merci !</p>");
    expect(msg).toContain('Content-Disposition: attachment; filename="CV_Lea_Martin.pdf"');

    const attIdx = msg.indexOf("Content-Type: application/pdf");
    const start = msg.indexOf("\r\n\r\n", attIdx) + 4;
    const end = msg.indexOf("\r\n--", start);
    expect(new Uint8Array(Buffer.from(msg.slice(start, end), "base64"))).toEqual(PDF);
  });

  it("encodes non-ASCII subject and display name with RFC 2047", () => {
    const msg = decode(buildMimeMessage(input()));
    const subject = msg.match(/Subject: (.*(?:\r\n .*)*)/)![1];
    expect(subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(subject)).toBe("Alternance Business Analyst – sept. 2027 – Acme");
    const from = msg.match(/From: (.*(?:\r\n .*)*)/)![1];
    expect(decodeWords(from)).toBe("Léa Martin <lea.martin@gmail.com>");
  });

  it("keeps ASCII headers readable and quotes display names", () => {
    const msg = decode(
      buildMimeMessage(input({ subject: "Stage - Acme", from: { name: 'Jo "J" Doe', email: "jo@x.fr" } })),
    );
    expect(msg).toContain("Subject: Stage - Acme\r\n");
    expect(msg).toContain('From: "Jo \\"J\\" Doe" <jo@x.fr>\r\n');
  });

  it("splits long encoded subjects into words of at most 75 chars", () => {
    const encoded = encodeHeaderWord("é".repeat(100));
    for (const word of encoded.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(encoded)).toBe("é".repeat(100));
  });

  it("rejects header injection and invalid addresses", () => {
    expect(() => buildMimeMessage(input({ subject: "Hi\r\nBcc: x@y.z" }))).toThrow(MimeError);
    expect(() => buildMimeMessage(input({ to: "a@b.fr\nBcc: c@d.fr" }))).toThrow(MimeError);
    expect(() => buildMimeMessage(input({ to: "a@b.fr, c@d.fr" }))).toThrow(MimeError);
    expect(() =>
      buildMimeMessage(input({ from: { name: "x\r\nBcc: y@z.fr", email: "a@b.fr" } })),
    ).toThrow(MimeError);
    expect(() => buildMimeMessage(input({ to: "not-an-email" }))).toThrow(MimeError);
  });

  it("works without attachment", () => {
    const msg = decode(buildMimeMessage(input({ attachment: undefined })));
    expect(msg).not.toContain("Content-Disposition");
  });
});

describe("isValidEmail", () => {
  it("accepts normal addresses and refuses odd ones", () => {
    expect(isValidEmail("prenom.nom@acme-group.co.uk")).toBe(true);
    expect(isValidEmail("rh+jobs@acme.fr")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.fr")).toBe(false);
    expect(isValidEmail("<a@b.fr>")).toBe(false);
  });
});

describe("textToHtml", () => {
  it("escapes HTML and builds paragraphs", () => {
    const html = textToHtml("<script>x</script> & co\r\n\r\nLigne 1\nLigne 2");
    expect(html).toContain("<p>&lt;script&gt;x&lt;/script&gt; &amp; co</p>");
    expect(html).toContain("<p>Ligne 1<br>Ligne 2</p>");
    expect(html).not.toContain("<script>");
  });
});

describe("cvFilename", () => {
  it("builds CV_Prenom_Nom.pdf in ASCII", () => {
    expect(cvFilename("Léa Martin")).toBe("CV_Lea_Martin.pdf");
    expect(cvFilename("  jean   DUPONT ")).toBe("CV_Jean_Dupont.pdf");
    expect(cvFilename("Anne-Sophie Lefèvre")).toBe("CV_Anne-Sophie_Lefevre.pdf");
    expect(cvFilename("Chloé O'Brien")).toBe("CV_Chloe_O-Brien.pdf");
    expect(cvFilename("Ewan McCarthy")).toBe("CV_Ewan_McCarthy.pdf");
  });

  it("falls back to CV.pdf", () => {
    expect(cvFilename(null)).toBe("CV.pdf");
    expect(cvFilename("   ")).toBe("CV.pdf");
    expect(cvFilename("李雷")).toBe("CV.pdf");
  });
});
