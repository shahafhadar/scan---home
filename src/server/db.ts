import pg from "pg";

// Quantities are numeric in Postgres; keep them as JS numbers in JSON.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

let pool: pg.Pool | undefined;

/**
 * The device API's connection. It is privileged (it bypasses row level
 * security), which is why only the signed device routes use it: everything a
 * person does goes through Supabase with their own JWT instead.
 *
 * On Vercel, DATABASE_URL should be Supabase's transaction pooler (port 6543),
 * since every serverless instance opens its own pool.
 */
export const db = (): pg.Pool => {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    ssl: local
      ? undefined
      : process.env.DATABASE_CA_CERT
        ? { ca: process.env.DATABASE_CA_CERT }
        : { rejectUnauthorized: false },
  });
  return pool;
};

export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> => (await db().query<T>(text, params)).rows;

export const one = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> => (await query<T>(text, params))[0];

/** For tests: drop the pool so the next call reconnects. */
export const closeDb = async (): Promise<void> => {
  await pool?.end();
  pool = undefined;
};
