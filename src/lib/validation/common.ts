import { z } from "zod";

/** Shared validation primitives (version-proof: no deprecated zod helpers). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const zEmail = () =>
  z
    .string()
    .trim()
    .min(3)
    .max(320)
    .refine((v) => EMAIL_RE.test(v), "Enter a valid email address.")
    .transform((v) => v.toLowerCase());

export const zPassword = () => z.string().min(1, "Password is required.").max(200);

export const zId = () => z.string().regex(UUID_RE, "Invalid identifier.");

export const zShortText = (max = 200) => z.string().trim().max(max, `Use at most ${max} characters.`);

export const zLongText = (max = 5000) => z.string().max(max, `Use at most ${max} characters.`);

export const zOptionalText = (max = 2000) =>
  z
    .string()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const zTimezone = () =>
  z
    .string()
    .trim()
    .max(64)
    .refine((v) => {
      try {
        return Boolean(Intl.DateTimeFormat().resolvedOptions().timeZone && new Intl.DateTimeFormat("en", { timeZone: v }).format());
      } catch {
        return false;
      }
    }, "Use a valid IANA timezone such as Africa/Nairobi.");

export const zLocalTime = () =>
  z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use a 24-hour time such as 09:00.");

export const zDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.");

/** Convert a password-policy issue list into the standard error details shape. */
export function issuesToDetails(issues: string[], field = "password"): Record<string, string[]> {
  return { [field]: issues };
}
