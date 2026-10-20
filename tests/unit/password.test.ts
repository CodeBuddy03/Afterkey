import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password policy", () => {
  it("accepts a reasonable password", () => {
    expect(checkPasswordPolicy("correct-horse-42")).toEqual({ ok: true, issues: [] });
  });

  it("rejects short passwords", () => {
    const r = checkPasswordPolicy("ab1234567");
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("Use at least 10 characters.");
  });

  it("requires a letter and a number", () => {
    expect(checkPasswordPolicy("abcdefghijkl").issues).toContain("Include at least one number.");
    expect(checkPasswordPolicy("1234567890123").issues).toContain("Include at least one letter.");
  });

  it("rejects an over-long password", () => {
    expect(checkPasswordPolicy(`a1${"x".repeat(200)}`).issues).toContain("Use at most 200 characters.");
  });

  it("rejects well-known passwords case-insensitively", () => {
    expect(checkPasswordPolicy("Admin12345").issues).toContain("This password is too easy to guess.");
    expect(checkPasswordPolicy("password1").ok).toBe(false);
  });

  it("reports every issue at once", () => {
    const r = checkPasswordPolicy("!"); // too short, no letter, no number
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("argon2id hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct-horse-42");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct-horse-42");
    expect(await verifyPassword(hash, "correct-horse-42")).toBe(true);
  });

  it("never verifies the wrong password", async () => {
    const hash = await hashPassword("correct-horse-42");
    expect(await verifyPassword(hash, "correct-horse-43")).toBe(false);
  });

  it("salts: identical passwords produce different hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-password-1")).toBe(true);
    expect(await verifyPassword(b, "same-password-1")).toBe(true);
  });

  it("returns false for empty or malformed stored hashes", async () => {
    expect(await verifyPassword("", "anything")).toBe(false);
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});
