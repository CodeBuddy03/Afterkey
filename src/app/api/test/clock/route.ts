import { testRoutesEnabled } from "@/lib/env";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { advanceTestClock, refreshClock, setTestClockOffset } from "@/lib/clock";
import { runWorkerCycle } from "@/lib/jobs/worker";
import { z } from "zod";

/**
 * TEST-ONLY endpoints (AFTERKEY_ENABLE_TEST_ROUTES=true).
 *
 * These routes do not bypass authentication or policy checks — they only move
 * the controlled clock and run the ordinary worker cycle, exactly like the
 * background worker would. Every release condition is still evaluated by
 * release/engine.ts at execution time. 404 unless enabled; production
 * configuration refuses to enable them (src/lib/env.ts).
 */

const schema = z
  .object({
    advanceMs: z.number().int().min(0).max(1000 * 60 * 60 * 24 * 400).optional(),
    setMs: z.number().int().min(0).optional(),
    runJobs: z.boolean().optional(),
  })
  .refine((v) => v.advanceMs !== undefined || v.setMs !== undefined || v.runJobs !== undefined, {
    message: "Provide advanceMs, setMs or runJobs.",
  });

export const POST = handleRoute(async (req) => {
  if (!testRoutesEnabled()) return fail(404, "not_found", "Not found");
  const body = await readJson(req, schema);

  if (body.setMs !== undefined) await setTestClockOffset(body.setMs);
  else if (body.advanceMs !== undefined) await advanceTestClock(body.advanceMs);
  await refreshClock();

  let cycle = null;
  if (body.runJobs) {
    cycle = await runWorkerCycle("test-tick", { maxJobs: 200 });
  }

  const { now } = await import("@/lib/clock");
  return ok({ now: now().toISOString(), cycle });
});
