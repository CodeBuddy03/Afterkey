import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with Argon2id (OWASP-recommended parameters:
 * 19 MiB memory, 2 iterations, 1 lane). @node-rs/argon2 defaults to the
 * Argon2id algorithm. Hashes are self-describing, so parameters can be raised
 * later and old hashes still verify.
 */

const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (!storedHash || !password) return false;
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  issues: string[];
}

/** Password policy for registration, reset and password changes. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const issues: string[] = [];
  if (password.length < 10) issues.push("Use at least 10 characters.");
  if (password.length > 200) issues.push("Use at most 200 characters.");
  if (!/[a-zA-Z]/.test(password)) issues.push("Include at least one letter.");
  if (!/[0-9]/.test(password)) issues.push("Include at least one number.");
  const common = ["password1", "1234567890", "qwertyuiop", "letmein123", "admin12345"];
  if (common.includes(password.toLowerCase())) issues.push("This password is too easy to guess.");
  return { ok: issues.length === 0, issues };
}
