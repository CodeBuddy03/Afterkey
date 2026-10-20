import crypto from "crypto";
import { env } from "../env";

/**
 * Envelope encryption primitives (AES-256-GCM).
 *
 * Key separation:
 *   - Master KEK (AFTERKEY_ENCRYPTION_KEY): wraps per-vault data keys. Used by
 *     the server so the release worker can decrypt under verified conditions.
 *   - Vault DEK: encrypts one vault's sensitive content. Never stored in plaintext.
 *   - AFTERKEY_APP_SECRET: HMAC only (pseudonymization, verifiers). Never encrypts.
 *
 * This is encryption at rest with server-side key custody — NOT zero-knowledge
 * encryption. See docs/security-architecture.md before making any claim.
 */

const ENC_PREFIX = "enc:v1:";
const WRAP_PREFIX = "v1:";

export function getMasterKey(): Buffer {
  const b64 = env().AFTERKEY_ENCRYPTION_KEY;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("Encryption master key must be 32 bytes (base64). See .env.example.");
  }
  return key;
}

export function generateDek(): Buffer {
  return crypto.randomBytes(32);
}

function seal(plaintext: Buffer, kek: Buffer, aad?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${WRAP_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function open(payload: string, kek: Buffer, aad?: string): Buffer {
  if (!payload.startsWith(WRAP_PREFIX)) throw new Error("Malformed wrapped value");
  const [ivB64, tagB64, ctB64] = payload.slice(WRAP_PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed wrapped value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, Buffer.from(ivB64, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
}

/** Wrap (seal) a key with another key. */
export function wrapKey(dek: Buffer, kek: Buffer): string {
  return seal(dek, kek);
}

/** Unwrap a sealed key. Throws when authentication fails (wrong key / tampering). */
export function unwrapKey(wrapped: string, kek: Buffer): Buffer {
  const out = open(wrapped, kek);
  if (out.length !== 32) throw new Error("Unwrapped key has unexpected length");
  return out;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

export function encryptText(plaintext: string | null | undefined, dek: Buffer, aad?: string): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  return ENC_PREFIX + seal(Buffer.from(plaintext, "utf8"), dek, aad);
}

export function decryptText(payload: string | null | undefined, dek: Buffer, aad?: string): string | null {
  if (payload === null || payload === undefined) return null;
  if (!payload.startsWith(ENC_PREFIX)) {
    throw new Error("Value is not encrypted");
  }
  return open(payload.slice(ENC_PREFIX.length), dek, aad).toString("utf8");
}

/**
 * Decrypt only when the value is encrypted; pass through null. Throws on
 * malformed input. The AAD must match the one used at encryption time —
 * passing the wrong (or no) AAD fails authentication by design.
 */
export function decryptMaybe(payload: string | null | undefined, dek: Buffer, aad?: string): string | null {
  if (payload === null || payload === undefined) return null;
  if (!isEncrypted(payload)) return payload;
  return decryptText(payload, dek, aad);
}

export interface SealedBuffer {
  iv: string;
  tag: string;
  ciphertext: Buffer;
}

export function encryptBuffer(plaintext: Buffer, dek: Buffer, aad?: string): SealedBuffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ct };
}

export function decryptBuffer(ciphertext: Buffer, iv: string, tag: string, dek: Buffer, aad?: string): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, Buffer.from(iv, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Cryptographically secure URL-safe token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Uniform crypto-random decimal string of exactly `digits` digits (for OTP codes). */
export function randomDigits(digits: number): string {
  let out = "";
  for (let i = 0; i < digits; i += 1) out += String(crypto.randomInt(0, 10));
  return out;
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** HMAC used for pseudonymization and verifiers (never for encryption). */
export function hmacHex(value: string, secret?: string): string {
  const key = secret ?? env().AFTERKEY_APP_SECRET;
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/** Constant-time string comparison for equal-length hex/base64 values. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
