import "server-only";
import pg from "pg";

// bigint (int8) and numeric come back as JS numbers. Cents fit easily in a double.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// date stays a "YYYY-MM-DD" string: accounting dates have no time zone.
pg.types.setTypeParser(1082, (v) => v);

const globalForPool = globalThis as unknown as { pgPool?: pg.Pool };
export const pool =
  globalForPool.pgPool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pool;

export type Db = Pick<pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export interface TxOptions {
  /** allow writes dated in a closed period (after the close password was checked) */
  closeOverride?: boolean;
  /** allow changing reconciled ledger entries (after the user confirmed) */
  reconciledOverride?: boolean;
}

/** Run `fn` in one database transaction. The ledger balance check runs at commit. */
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (opts.closeOverride) await client.query("set local app.close_override = 'on'");
    if (opts.reconciledOverride) await client.query("set local app.reconciled_override = 'on'");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
