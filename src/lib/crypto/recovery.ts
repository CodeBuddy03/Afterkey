import crypto from "crypto";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hmacHex, safeEqual, unwrapKey, wrapKey } from "./encryption";
import { env } from "../env";

/**
 * 24-word recovery phrase support.
 *
 * Design (documented in docs/security-architecture.md §Recovery):
 *   - 24 words = 256 bits from the OS CSPRNG (BIP-39 English wordlist).
 *   - Shown exactly once during setup; never stored, never emailed.
 *   - A key derived from the phrase wraps a second copy of the vault DEK, so
 *     the phrase can recover access to encrypted vault content if the server
 *     master key is ever rotated or lost — and proves possession of the
 *     account during password recovery.
 *   - The server stores only: a wrapped copy of the DEK (ciphertext) and an
 *     HMAC verifier of the derived key. Both are useless without the phrase.
 *   - Derivation is deliberately expensive (PBKDF2-SHA256, 210k iterations) to
 *     slow offline guessing; online attempts are rate-limited separately.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_CONTEXT = "afterkey-recovery-v1";

export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256); // 24 words
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  try {
    return validateMnemonic(normalizePhrase(phrase), wordlist);
  } catch {
    return false;
  }
}

function deriveRecoveryKey(phrase: string): Buffer {
  return crypto.pbkdf2Sync(normalizePhrase(phrase), SALT_CONTEXT, PBKDF2_ITERATIONS, 32, "sha256");
}

export interface RecoveryMaterial {
  /** Sealed copy of the vault DEK, keyed by the phrase. Store this. */
  wrapped: string;
  /** HMAC verifier of the derived key. Store this; reveals nothing about the phrase. */
  verifier: string;
}

export function createRecoveryMaterial(dek: Buffer, phrase: string): RecoveryMaterial {
  if (!isValidRecoveryPhrase(phrase)) throw new Error("Invalid recovery phrase");
  const derived = deriveRecoveryKey(phrase);
  const wrapped = wrapKey(dek, derived);
  const verifier = hmacHex(derived.toString("base64"));
  derived.fill(0);
  return { wrapped, verifier };
}

export function verifyRecoveryPhrase(phrase: string, verifier: string): boolean {
  if (!isValidRecoveryPhrase(phrase)) return false;
  const derived = deriveRecoveryKey(phrase);
  const candidate = hmacHex(derived.toString("base64"));
  derived.fill(0);
  return safeEqual(candidate, verifier);
}

/** Unseal the vault DEK with a recovery phrase. Throws when the phrase is wrong. */
export function unwrapWithRecoveryPhrase(phrase: string, wrapped: string): Buffer {
  if (!isValidRecoveryPhrase(phrase)) throw new Error("Invalid recovery phrase");
  const derived = deriveRecoveryKey(phrase);
  try {
    return unwrapKey(wrapped, derived);
  } finally {
    derived.fill(0);
  }
}

/** Bytes of entropy in the generated phrase (for UI display). */
export const RECOVERY_PHRASE_BITS = 256;

/** Recovery phrases are never logged; this guard documents that intent. */
export function assertNeverLogPhrase(phrase: string): void {
  if (env().LOG_LEVEL === "debug" && /\b(recovery|phrase)\b/i.test(phrase)) {
    throw new Error("Recovery phrase must never be logged");
  }
}
