import { describe, expect, it } from "vitest";

import { CvError, extractCvText, hasPdfMagic, normalizeCvText } from "@/lib/profile/parse-cv";
import { CV_MAX_BYTES, CV_MIN_TEXT_CHARS } from "@/lib/profile/schema";

import { CV_FIXTURES, readCvPdf, readExpected } from "./fixtures/cv";

async function expectCvError(promise: Promise<unknown>, code: CvError["code"]) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CvError);
  expect((err as CvError).code).toBe(code);
  expect((err as CvError).userMessage.length).toBeGreaterThan(20);
}

describe("extractCvText", () => {
  it.each(CV_FIXTURES)("extracts the text of %s", async (name) => {
    const expected = readExpected(name);
    const text = await extractCvText(readCvPdf(name));
    expect(text.length).toBeGreaterThanOrEqual(CV_MIN_TEXT_CHARS);
    expect(text).toContain(expected.full_name!);
    expect(text).toContain(expected.school!);
    expect(text).toContain(expected.email!);
    expect(text).not.toMatch(/[^\S\n]{2,}/); // whitespace runs collapsed
    expect(text).toBe(text.trim());
  });

  it("does not detach the caller's buffer", async () => {
    const pdf = readCvPdf("cv-dev");
    await extractCvText(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("rejects a scanned CV (almost no text) with too_short", async () => {
    await expectCvError(extractCvText(readCvPdf("cv-scanned")), "too_short");
    const err = await extractCvText(readCvPdf("cv-scanned")).catch((e: CvError) => e);
    expect((err as CvError).userMessage).toContain("image scannée");
  });

  it("rejects non-PDF bytes with not_pdf", async () => {
    await expectCvError(
      extractCvText(new TextEncoder().encode("Bonjour, je suis un CV")),
      "not_pdf",
    );
    await expectCvError(extractCvText(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "not_pdf");
  });

  it("rejects a corrupted PDF with not_pdf", async () => {
    await expectCvError(
      extractCvText(new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf")),
      "not_pdf",
    );
  });

  it("rejects files over CV_MAX_BYTES with too_large", async () => {
    const big = new Uint8Array(CV_MAX_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.7"));
    await expectCvError(extractCvText(big), "too_large");
  });
});

describe("helpers", () => {
  it("hasPdfMagic", () => {
    expect(hasPdfMagic(new TextEncoder().encode("%PDF-1.4"))).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode("\n\n%PDF-1.4"))).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode("%PD"))).toBe(false);
    expect(hasPdfMagic(new Uint8Array())).toBe(false);
  });

  it("normalizeCvText", () => {
    expect(normalizeCvText("  a   b \t c \r\n\r\n\r\n\n  d  \n")).toBe("a b c\n\nd");
  });

  it("CvError never carries content in its message", () => {
    const err = new CvError("llm_failed");
    expect(err.message).toBe("CV processing failed: llm_failed");
    expect(err.name).toBe("CvError");
  });
});
