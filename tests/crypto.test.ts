import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CryptoError, decrypt, encrypt } from "@/lib/crypto";

const key = randomBytes(32);

function flipLastChar(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[buf.length - 1] ^= 0x01;
  return buf.toString("base64");
}

describe("crypto (AES-256-GCM)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips", () => {
    for (const text of ["ya29.abc", "1//0abc", "", "émoji 🔐 accentué", "x".repeat(5000)]) {
      expect(decrypt(encrypt(text, key), key)).toBe(text);
    }
  });

  it("uses the versioned v1 format with a 12-byte IV and 16-byte tag", () => {
    const parts = encrypt("ya29.abc", key).split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });

  it("produces different ciphertexts for the same input", () => {
    const a = encrypt("ya29.abc", key);
    const b = encrypt("ya29.abc", key);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
  });

  it("never contains the plaintext (SPEC §6: no ya29. / 1// in column)", () => {
    for (const token of [
      "ya29.abc",
      "1//0abc",
      "ya29.a0AfH6SMBxyz-long-token",
      "1//0gLongRefresh",
    ]) {
      const out = encrypt(token, key);
      expect(out).not.toContain(token);
      expect(out.startsWith("ya29.")).toBe(false);
      expect(out.startsWith("1//")).toBe(false);
    }
  });

  it("throws on tampered ciphertext", () => {
    const [v, iv, tag, ct] = encrypt("ya29.abc", key).split(":");
    expect(() => decrypt([v, iv, tag, flipLastChar(ct)].join(":"), key)).toThrow(CryptoError);
  });

  it("throws on tampered tag", () => {
    const [v, iv, tag, ct] = encrypt("ya29.abc", key).split(":");
    expect(() => decrypt([v, iv, flipLastChar(tag), ct].join(":"), key)).toThrow(CryptoError);
  });

  it("throws on tampered IV", () => {
    const [v, iv, tag, ct] = encrypt("ya29.abc", key).split(":");
    expect(() => decrypt([v, flipLastChar(iv), tag, ct].join(":"), key)).toThrow(CryptoError);
  });

  it("throws with the wrong key", () => {
    const payload = encrypt("ya29.abc", key);
    expect(() => decrypt(payload, randomBytes(32))).toThrow(/Decryption failed/);
  });

  it("throws on bad key length", () => {
    expect(() => encrypt("x", randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decrypt(encrypt("x", key), randomBytes(31))).toThrow(/32 bytes/);
  });

  it("throws on malformed payloads and unknown versions", () => {
    const [, iv, tag, ct] = encrypt("x", key).split(":");
    expect(() => decrypt("garbage", key)).toThrow(/Malformed/);
    expect(() => decrypt(`v2:${iv}:${tag}:${ct}`, key)).toThrow(/version/);
    expect(() => decrypt(`v1:${iv}:${tag}`, key)).toThrow(/Malformed/);
    expect(() => decrypt(`v1:!!:${tag}:${ct}`, key)).toThrow(/Malformed/);
  });

  it("does not leak the plaintext in error messages", () => {
    const payload = encrypt("ya29.secret", key);
    try {
      decrypt(payload, randomBytes(32));
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("ya29");
    }
  });

  it("reads the key from TOKEN_ENCRYPTION_KEY by default", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", key.toString("base64"));
    const payload = encrypt("1//0abc");
    expect(decrypt(payload, key)).toBe("1//0abc");
    expect(decrypt(payload)).toBe("1//0abc");
  });

  it("rejects an env key that does not decode to 32 bytes", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
