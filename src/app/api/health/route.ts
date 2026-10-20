import { ok } from "@/lib/api/http";

/** Liveness: process is up. No dependencies, no secrets. */
export const GET = async (): Promise<Response> =>
  ok({ status: "ok", service: "afterkey", time: new Date().toISOString() });

export const dynamic = "force-dynamic";
