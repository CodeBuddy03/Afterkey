import { Pool, types, type QueryResultRow } from "pg";
import { env } from "./env";

// Counters and identity columns come back as numbers (safe: they never reach
// 2^53 in this application).
types.setTypeParser(20, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v)); // numeric -> number
// DATE columns (anchor dates, opened/reviewed dates) are calendar dates, not
// instants: keep the exact "YYYY-MM-DD" text so schedule math and <input
// type="date"> values never shift across timezones. (pg's default parser
// returns a local-midnight Date, which both stringifies wrong for JSON and
// breaks nextDueAfter's anchor parsing.)
types.setTypeParser(1082, (v: string) => v);

/** Convert snake_case column aliases to camelCase object keys (top level only). */
export function camelizeRow<T extends QueryResultRow = QueryResultRow>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    out[camel] = (row as Record<string, unknown>)[key];
  }
  return out as T;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "afterkey",
    });
    pool.on("error", (err) => {
      // Never let a background client error crash the process.
      const _ = err;
    });
  }
  return pool;
}

export type Row = Record<string, unknown>;

export interface Queryable {
  q<T extends QueryResultRow = Row>(text: string, params?: unknown[]): Promise<T[]>;
  q1<T extends QueryResultRow = Row>(text: string, params?: unknown[]): Promise<T | null>;
  raw(text: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

/** Shared database helper for request handlers and scripts. */
export const db: Queryable = {
  q: async <T extends QueryResultRow = Row>(text: string, params?: unknown[]) =>
    (await getPool().query(text, params)).rows.map((r) => camelizeRow(r as T)),
  q1: async <T extends QueryResultRow = Row>(text: string, params?: unknown[]) => {
    const res = await getPool().query(text, params);
    return res.rows.length ? camelizeRow(res.rows[0] as T) : null;
  },
  raw: async (text: string, params?: unknown[]) => {
    const res = await getPool().query(text, params);
    return { rowCount: res.rowCount ?? null };
  },
};

export interface Tx extends Queryable {
  client: import("pg").PoolClient;
}

/** Run `fn` inside a single transaction; commits on success, rolls back on throw. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const tx: Tx = {
    client,
    async q<R extends QueryResultRow = Row>(text: string, params?: unknown[]) {
      const res = await client.query(text, params);
      return res.rows.map((r) => camelizeRow(r as R));
    },
    async q1<R extends QueryResultRow = Row>(text: string, params?: unknown[]) {
      const res = await client.query(text, params);
      return res.rows.length ? camelizeRow(res.rows[0] as R) : null;
    },
    async raw(text: string, params?: unknown[]) {
      const res = await client.query(text, params);
      return { rowCount: res.rowCount ?? null };
    },
  };
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Liveness probe for /api/ready. */
export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.q1("SELECT 1 AS ok");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown database error" };
  }
}
