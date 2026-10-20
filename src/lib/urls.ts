import { env } from "./env";

/** Absolute application URL for links in emails and notifications. */
export function appUrl(path: string): string {
  const base = env().APP_URL.replace(/\/+$/, "");
  if (!path) return base;
  return base + (path.startsWith("/") ? path : `/${path}`);
}
