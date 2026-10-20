import { db } from "./db";
import { env } from "./env";

/**
 * Controlled clock. All engines read time through `now()` so tests can advance
 * time with the test-only clock API (enabled by AFTERKEY_ENABLE_TEST_ROUTES).
 * Without that flag the offset is always 0 and no database read happens.
 */
let offsetMs = 0;
let loadedAt = 0;
const TTL_MS = 1000;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

/** Reload the persisted test-clock offset (used by test routes and the worker). */
export async function refreshClock(): Promise<void> {
  if (!env().AFTERKEY_ENABLE_TEST_ROUTES) {
    offsetMs = 0;
    loadedAt = Date.now();
    return;
  }
  if (Date.now() - loadedAt < TTL_MS) return;
  try {
    const row = await db.q1<{ value: unknown }>("SELECT value FROM system_settings WHERE key = $1", [
      "test_clock_offset_ms",
    ]);
    const parsed = row ? Number((row.value as { ms?: number })?.ms ?? 0) : 0;
    offsetMs = Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Database not ready: keep the previous offset.
  }
  loadedAt = Date.now();
}

export async function setTestClockOffset(ms: number): Promise<void> {
  offsetMs = ms;
  loadedAt = Date.now();
  await db.raw(
    `INSERT INTO system_settings (key, value) VALUES ('test_clock_offset_ms', jsonb_build_object('ms', $1::double precision))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [ms],
  );
}

export async function advanceTestClock(deltaMs: number): Promise<number> {
  await refreshClock();
  const next = offsetMs + deltaMs;
  await setTestClockOffset(next);
  return next;
}

export function resetClock(): void {
  offsetMs = 0;
  loadedAt = 0;
}
