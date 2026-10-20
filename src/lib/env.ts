import { z } from "zod";

/**
 * Environment validation.
 *
 * - Development runs with explicit, well-known development-only secrets.
 * - Production refuses to boot with those development secrets, with a missing
 *   malware-scan integration (unless explicitly acknowledged) or with the
 *   test-only control routes enabled.
 */

export const DEV_ENCRYPTION_KEY_PLAINTEXT = "dev-only-dev-only-dev-only-dev12"; // exactly 32 bytes, dev only
export const DEV_APP_SECRET = "dev-only-app-secret-change-me-0000000000000000";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "yes");

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .refine((n) => Number.isFinite(n), "must be a number");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AFTERKEY_ENCRYPTION_KEY: z.string().min(1, "AFTERKEY_ENCRYPTION_KEY is required"),
  AFTERKEY_APP_SECRET: z.string().min(16, "AFTERKEY_APP_SECRET must be at least 16 characters"),

  EMAIL_PROVIDER: z.enum(["file", "smtp", "resend"]).default("file"),
  EMAIL_FROM: z.string().default("AfterKey <no-reply@afterkey.com>"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_ADMIN_ADDRESS: z.string().default("admin@afterkey.com"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./var/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MALWARE_SCAN_URL: z.string().optional(),
  ALLOW_UNSCANNED_UPLOADS: boolish,

  MAP_PROVIDER: z.enum(["nominatim", "maptiler", "mapbox"]).optional(),
  MAP_GEOCODE_URL: z.string().optional(),
  MAP_GEOCODE_API_KEY: z.string().optional(),
  MAP_STYLE_URL: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  WORKER_POLL_MS: num(15000),
  WORKER_BATCH: num(10),
  RELEASE_DELAY_SECONDS: num(7200),
  MAX_UPLOAD_BYTES: num(25 * 1024 * 1024),
  SESSION_TTL_DAYS: num(30),

  AFTERKEY_ENABLE_TEST_ROUTES: boolish,
  AFTERKEY_ENABLE_DEV_SEED: boolish,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function base64KeyToBuffer(b64: string): Buffer | null {
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** Parsed, validated environment. Throws with an actionable message when invalid. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example and docs/setup.md.`);
  }
  const e = parsed.data;

  const problems: string[] = [];

  if (base64KeyToBuffer(e.AFTERKEY_ENCRYPTION_KEY) === null) {
    problems.push(
      "AFTERKEY_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const isProd = e.NODE_ENV === "production";

  if (isProd) {
    const devCipherPrefix = Buffer.from(DEV_ENCRYPTION_KEY_PLAINTEXT, "utf8").toString("base64");
    if (
      e.AFTERKEY_ENCRYPTION_KEY === devCipherPrefix ||
      e.AFTERKEY_ENCRYPTION_KEY.startsWith("ZGV2LW9ubHkt")
    ) {
      problems.push("AFTERKEY_ENCRYPTION_KEY is the development key and must never be used in production.");
    }
    if (e.AFTERKEY_APP_SECRET.startsWith("dev-only")) {
      problems.push("AFTERKEY_APP_SECRET is a development placeholder and must be replaced in production.");
    }
    if (e.AFTERKEY_ENABLE_TEST_ROUTES) {
      problems.push("AFTERKEY_ENABLE_TEST_ROUTES must be disabled in production.");
    }
    if (e.EMAIL_PROVIDER === "file") {
      problems.push(
        "EMAIL_PROVIDER=file stores messages in the database instead of sending them; configure an SMTP or Resend provider in production.",
      );
    }
    if (!e.MALWARE_SCAN_URL && !e.ALLOW_UNSCANNED_UPLOADS) {
      problems.push(
        "Set MALWARE_SCAN_URL (recommended) or explicitly set ALLOW_UNSCANNED_UPLOADS=true in production.",
      );
    }
    if (e.STORAGE_DRIVER === "s3") {
      if (!e.S3_BUCKET || !e.S3_REGION || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
        problems.push("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
      }
    }
  }

  if (e.ALLOW_UNSCANNED_UPLOADS === undefined) {
    e.ALLOW_UNSCANNED_UPLOADS = !isProd;
  }

  if (problems.length > 0) {
    throw new Error(`Unsafe environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }

  cached = e;
  return e;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

export function testRoutesEnabled(): boolean {
  return env().AFTERKEY_ENABLE_TEST_ROUTES === true && env().NODE_ENV !== "production";
}

/** Forget cached env (tests only). */
export function resetEnvCache(): void {
  cached = null;
}
