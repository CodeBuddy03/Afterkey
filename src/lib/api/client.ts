"use client";

/**
 * Typed client for the AfterKey API. Every response uses the standard envelope:
 *   success -> { data: T }   failure -> { error: { code, message, details? } }
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "x-requested-with": "afterkey",
    ...(opts.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiClientError(0, "network_error", "We could not reach the server. Check your connection and try again.");
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | null)?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "request_failed",
      err?.message ?? (res.status >= 500 ? "Something went wrong on our side. Please try again." : "The request could not be completed."),
      err?.details,
    );
  }

  return ((payload as { data?: T } | null)?.data ?? payload) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PATCH", path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PUT", path, { ...opts, body: body ?? {} }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),
  upload: <T>(path: string, formData: FormData, opts?: RequestOptions) =>
    request<T>("POST", path, { ...opts, formData }),
};

/** Extract field errors for form display. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiClientError && err.details) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(err.details)) out[k] = v[0] ?? "Invalid value";
    return out;
  }
  return {};
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
