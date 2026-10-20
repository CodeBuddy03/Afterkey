import { testRoutesEnabled } from "@/lib/env";
import { fail, handleRoute, ok } from "@/lib/api/http";
import { refreshClock } from "@/lib/clock";
import { runWorkerCycle } from "@/lib/jobs/worker";

/** TEST-ONLY: run one worker cycle inline (see /api/test/clock for the policy). */
export const POST = handleRoute(async () => {
  if (!testRoutesEnabled()) return fail(404, "not_found", "Not found");
  await refreshClock();
  const result = await runWorkerCycle("test-tick", { maxJobs: 200 });
  return ok(result);
});
