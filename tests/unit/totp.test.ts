import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { newTotpSecret, totpUri, verifyTotp } from "@/lib/auth/totp";

describe("TOTP helpers", () => {
  it("generates a 20-byte base32 secret", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32); // 160 bits base32-encoded
    expect(newTotpSecret()).not.toBe(secret);
  });

  it("builds an otpauth:// URI scoped to AfterKey", () => {
    const uri = totpUri("person@example.com", "JBSWY3DPEHPK3PXP");
    expect(uri.startsWith("otpauth://totp/AfterKey:")).toBe(true);
    expect(uri).toContain("person%40example.com");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    // otplib omits parameters that match the defaults (6 digits, 30 s).
  });

  it("verifies the current authenticator code", () => {
    const secret = newTotpSecret();
    const code = generateSync({ secret });
    expect(verifyTotp(secret, String(code))).toBe(true);
  });

  it("tolerates whitespace in user-entered codes", () => {
    const secret = newTotpSecret();
    const code = String(generateSync({ secret }));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced)).toBe(true);
  });

  it("rejects wrong or malformed codes", () => {
    const secret = newTotpSecret();
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "abc")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "123456")).toBe(false);
  });
});
