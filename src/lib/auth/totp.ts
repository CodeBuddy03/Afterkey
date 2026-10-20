import { generateSecret, generateURI, verifySync } from "otplib";

/**
 * TOTP (RFC 6238) helpers built on otplib — no home-grown cryptography.
 * otplib v13 exposes functional helpers with pluggable crypto (noble by default).
 */

export function newTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: "AfterKey", label: email, secret, period: 30, digits: 6 });
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    const result = verifySync({ secret, token: token.trim().replace(/\s+/g, "") });
    return Boolean(result && (result as { valid?: boolean }).valid);
  } catch {
    return false;
  }
}
