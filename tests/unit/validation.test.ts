import { describe, expect, it } from "vitest";
import {
  issuesToDetails,
  zDate,
  zEmail,
  zId,
  zLocalTime,
  zOptionalText,
  zTimezone,
} from "@/lib/validation/common";
import { appUrl } from "@/lib/urls";

describe("zEmail", () => {
  it("trims, lowercases and accepts valid addresses", () => {
    expect(zEmail().parse("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["nope", "a@b", "a@b.c", "two words@example.com", "a@@b.com", "@example.com"]) {
      expect(zEmail().safeParse(bad).success).toBe(false);
    }
  });
});

describe("zId", () => {
  it("accepts uuid v1-v8 shapes", () => {
    expect(zId().parse("84c3019a-122b-44d9-b399-4c04dc5f7117")).toBeTruthy();
    expect(zId().parse("00000000-0000-4000-8000-000000000000")).toBeTruthy();
  });

  it("rejects non-uuid identifiers (id probing protection)", () => {
    for (const bad of ["1", "users/1", "84c3019a122b44d9b3994c04dc5f7117", "not-a-uuid"]) {
      expect(zId().safeParse(bad).success).toBe(false);
    }
  });
});

describe("time inputs", () => {
  it("accepts 24-hour local times and rejects 12-hour ones", () => {
    expect(zLocalTime().parse("09:00")).toBe("09:00");
    expect(zLocalTime().parse("23:59")).toBe("23:59");
    expect(zLocalTime().safeParse("9:00 AM").success).toBe(false);
    expect(zLocalTime().safeParse("24:00").success).toBe(false);
  });

  it("accepts YYYY-MM-DD dates only", () => {
    expect(zDate().parse("2026-03-16")).toBe("2026-03-16");
    expect(zDate().safeParse("16/03/2026").success).toBe(false);
    expect(zDate().safeParse("2026-3-6").success).toBe(false);
  });

  it("validates IANA timezones", () => {
    expect(zTimezone().parse(" Africa/Nairobi ")).toBe("Africa/Nairobi");
    expect(zTimezone().safeParse("Mars/Base").success).toBe(false);
  });
});

describe("optional text", () => {
  it("converts empty strings to undefined but keeps content", () => {
    expect(zOptionalText(100).parse("")).toBeUndefined();
    expect(zOptionalText(100).parse("hello")).toBe("hello");
    expect(zOptionalText(3).safeParse("abcdef").success).toBe(false);
  });
});

describe("issuesToDetails", () => {
  it("maps policy issues onto the standard field-error shape", () => {
    expect(issuesToDetails(["Too short."])).toEqual({ password: ["Too short."] });
    expect(issuesToDetails(["x"], "email")).toEqual({ email: ["x"] });
  });
});

describe("appUrl", () => {
  it("joins the base URL with paths, tolerating trailing slashes", () => {
    expect(appUrl("/verify-email?token=abc")).toContain("/verify-email?token=abc");
    expect(appUrl("dashboard")).toContain("/dashboard");
    expect(appUrl("")).toMatch(/^http/);
  });
});
