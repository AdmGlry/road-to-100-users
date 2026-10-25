/**
 * Token encryption at rest (AES-256-GCM). SERVER ONLY.
 *
 * Payload format (versioned so the scheme can evolve / keys can rotate):
 *   v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *
 * Errors never include the plaintext or the key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getCryptoKey } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function resolveKey(key?: Buffer): Buffer {
  const k = key ?? getCryptoKey();
  if (k.length !== KEY_LENGTH) {
    throw new CryptoError(`Encryption key must be exactly ${KEY_LENGTH} bytes (got ${k.length})`);
  }
  return k;
}

export function encrypt(plaintext: string, key?: Buffer): string {
  const k = resolveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, k, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function decrypt(payload: string, key?: Buffer): string {
  const k = resolveKey(key);
  const parts = payload.split(":");
  if (parts.length !== 4) throw new CryptoError("Malformed encrypted payload");
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new CryptoError("Unsupported encrypted payload version");
  if (![ivB64, tagB64, ctB64].every((p) => B64.test(p))) {
    throw new CryptoError("Malformed encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new CryptoError("Malformed encrypted payload");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, k, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered data. Do not leak details.
    throw new CryptoError("Decryption failed (wrong key or tampered data)");
  }
}
