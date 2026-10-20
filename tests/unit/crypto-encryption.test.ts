import { describe, expect, it } from "vitest";
import {
  decryptBuffer,
  decryptMaybe,
  decryptText,
  encryptBuffer,
  encryptText,
  generateDek,
  getMasterKey,
  hmacHex,
  isEncrypted,
  randomDigits,
  randomToken,
  safeEqual,
  sha256Hex,
  unwrapKey,
  wrapKey,
} from "@/lib/crypto/encryption";

/**
 * Envelope-encryption primitives. These guard data at rest, so the tests
 * focus on the failure modes that matter: wrong key, wrong AAD, tampering.
 */

describe("AES-256-GCM text envelopes", () => {
  const dek = generateDek();

  it("round-trips UTF-8 text, including unicode", () => {
    const msg = "Passports — 2 copies 🛂, PIN 4417";
    const payload = encryptText(msg, dek);
    expect(payload).toBeTruthy();
    expect(isEncrypted(payload)).toBe(true);
    expect(decryptText(payload, dek)).toBe(msg);
  });

  it("passes null/undefined through without encrypting", () => {
    expect(encryptText(null, dek)).toBeNull();
    expect(encryptText(undefined, dek)).toBeNull();
    expect(decryptText(null, dek)).toBeNull();
    expect(decryptMaybe(undefined, dek)).toBeNull();
  });

  it("decryptMaybe passes plaintext through (migration tolerance)", () => {
    expect(decryptMaybe("legacy-plaintext", dek)).toBe("legacy-plaintext");
  });

  it("rejects decrypting plaintext that was never encrypted", () => {
    expect(() => decryptText("not-encrypted", dek)).toThrow(/not encrypted/i);
  });

  it("fails with the wrong key", () => {
    const payload = encryptText("secret", dek);
    expect(() => decryptText(payload, generateDek())).toThrow();
  });

  it("binds ciphertext to its AAD", () => {
    const payload = encryptText("record-1 body", dek, "message:123");
    expect(decryptText(payload, dek, "message:123")).toBe("record-1 body");
    expect(() => decryptText(payload, dek, "message:456")).toThrow();
    expect(() => decryptText(payload, dek)).toThrow();
  });

  it("detects tampering with the ciphertext", () => {
    const payload = encryptText("integrity matters", dek)!;
    const parts = payload.slice("enc:v1:".length).split(":"); // iv : tag : ct
    const ct = Buffer.from(parts[2]!, "base64");
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[2] = ct.toString("base64");
    expect(() => decryptText(`enc:v1:${parts.join(":")}`, dek)).toThrow();
  });
});

describe("key wrapping", () => {
  it("wraps and unwraps a 32-byte DEK", () => {
    const kek = getMasterKey();
    const dek = generateDek();
    const wrapped = wrapKey(dek, kek);
    expect(wrapped.startsWith("v1:")).toBe(true);
    expect(unwrapKey(wrapped, kek).equals(dek)).toBe(true);
  });

  it("refuses to unwrap with the wrong KEK", () => {
    const wrapped = wrapKey(generateDek(), getMasterKey());
    expect(() => unwrapKey(wrapped, generateDek())).toThrow();
  });

  it("rejects malformed wrapped values", () => {
    const kek = getMasterKey();
    expect(() => unwrapKey("nope", kek)).toThrow(/malformed/i);
    expect(() => unwrapKey("v1:onlytwo:parts", kek)).toThrow(/malformed/i);
  });
});

describe("buffer envelopes", () => {
  it("round-trips binary content with AAD", () => {
    const dek = generateDek();
    const data = Buffer.from([0, 1, 2, 250, 251, 252]);
    const { iv, tag, ciphertext } = encryptBuffer(data, dek, "doc:1");
    expect(decryptBuffer(ciphertext, iv, tag, dek, "doc:1").equals(data)).toBe(true);
    expect(() => decryptBuffer(ciphertext, iv, tag, dek, "doc:2")).toThrow();
  });
});

describe("token and digest helpers", () => {
  it("randomToken is URL-safe, correct entropy size and unique", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).toHaveLength(43); // ceil(32 * 4/3) without padding
    expect(a).not.toBe(b);
  });

  it("randomDigits returns exactly N decimal digits", () => {
    const code = randomDigits(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("sha256Hex matches the known vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hmacHex is deterministic and secret-bound", () => {
    const a = hmacHex("user@example.com");
    expect(a).toBe(hmacHex("user@example.com"));
    expect(a).not.toBe(hmacHex("other@example.com"));
    expect(a).not.toBe(hmacHex("user@example.com", "another-secret"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("safeEqual compares without length leakage", () => {
    expect(safeEqual("abcd", "abcd")).toBe(true);
    expect(safeEqual("abcd", "abce")).toBe(false);
    expect(safeEqual("abcd", "abcde")).toBe(false);
  });
});

describe("master key", () => {
  it("loads a 32-byte key from configuration", () => {
    expect(getMasterKey()).toHaveLength(32);
  });
});
