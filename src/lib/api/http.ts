import { ZodError, type ZodTypeAny, type z } from "zod";
import { log } from "../logger";

/**
 * Consistent API envelope:
 *   success -> { data: T }
 *   failure -> { error: { code, message, details? } }
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function zodDetails(err: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T): Response {
  return Response.json({ data }, { status: 201 });
}

export function fail(status: number, code: string, message: string, details?: Record<string, string[]>): Response {
  const body: { error: { code: string; message: string; details?: Record<string, string[]> } } = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return Response.json(body, { status });
}

/** Parse a JSON request body with a zod schema; throws a 400 ApiError. */
export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Please correct the highlighted fields.", zodDetails(parsed.error));
  }
  return parsed.data;
}

export function parseWith<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Please correct the highlighted fields.", zodDetails(parsed.error));
  }
  return parsed.data;
}

/**
 * Route wrapper: converts ApiError/ZodError into the standard envelope and
 * never leaks internals on unexpected failures.
 */
export function handleRoute(
  fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.status, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return fail(400, "invalid_request", "Please correct the highlighted fields.", zodDetails(err));
      }
      log.error("request_failed", {
        method: req.method,
        path: new URL(req.url).pathname,
        error: err instanceof Error ? err.message : "unknown",
        stack: err instanceof Error && process.env.NODE_ENV !== "production" ? err.stack : undefined,
      });
      return fail(500, "internal_error", "Something went wrong on our side. Please try again.");
    }
  };
}

/** Standard "not implemented because not configured" response. */
export function notConfigured(feature: string, hint: string): Response {
  return fail(503, "not_configured", `${feature} is not configured. ${hint}`);
}
