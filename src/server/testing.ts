/**
 * Test helpers: a throwaway database with the real migrations applied, and a
 * fake device that speaks the firmware's protocol to the real route handlers.
 * Used by the *.test.ts files only.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { closeDb, db } from "./db";
import { signPayload } from "./deviceAuth";

import { POST as registerRoute } from "@/app/api/v1/devices/register/route";
import { GET as claimStatusRoute } from "@/app/api/v1/devices/claim-status/route";
import { POST as heartbeatRoute } from "@/app/api/v1/devices/heartbeat/route";
import { POST as diagnosticsRoute } from "@/app/api/v1/devices/diagnostics/route";
import { POST as scanRoute } from "@/app/api/v1/scans/route";
import { POST as batchRoute } from "@/app/api/v1/scans/batch/route";

/** Admin connection to any database on the test server, e.g. postgres://postgres@localhost:5432/postgres */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const root = path.resolve(__dirname, "../..");

/** Creates a fresh database for one test file and points the app at it. */
export const setupTestDb = async (name: string): Promise<void> => {
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  const dbName = `scanhome_test_${name}_${process.pid}`;
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL!);
  url.pathname = `/${dbName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  // Roles are cluster wide, so two files may create them at once.
  await client.query("SELECT pg_advisory_lock(424242)");
  await client.query(readFileSync(path.join(root, "supabase/test/supabase-shim.sql"), "utf8"));
  await client.query("SELECT pg_advisory_unlock(424242)");
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(path.join(dir, file), "utf8"));
  }
  await client.end();

  await closeDb();
  process.env.DATABASE_URL = url.toString();
};

export const teardownTestDb = closeDb;

/** A new person, signed up the way Supabase Auth would: household and list included. */
export const createUser = async (): Promise<{ id: string; listId: string; householdId: string }> => {
  const id = randomUUID();
  await db().query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id}@example.test`]);
  const { rows } = await db().query<{ household_id: string; list_id: string }>(
    `SELECT m.household_id, l.id AS list_id
       FROM public.household_members m JOIN public.lists l ON l.household_id = m.household_id AND l.is_active
      WHERE m.user_id = $1`,
    [id],
  );
  return { id, householdId: rows[0]!.household_id, listId: rows[0]!.list_id };
};

/**
 * Runs SQL as a signed-in person (role `authenticated`, auth.uid() = userId),
 * exactly as the web app reaches the database through Supabase. Pass null to
 * run as an anonymous visitor. Always rolled back.
 */
export const asUser = async <T>(
  userId: string | null,
  fn: (q: <R extends pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> => {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${userId ? "authenticated" : "anon"}`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
};

/** Same as asUser, but commits. */
export const commitAsUser = async <T>(
  userId: string,
  fn: (q: <R extends pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> => {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

type Reply = { status: number; body: Record<string, unknown> & { [k: string]: unknown } };

const toReply = async (response: Response): Promise<Reply> => {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
};

const routes = {
  "GET /api/v1/devices/claim-status": claimStatusRoute,
  "POST /api/v1/devices/heartbeat": heartbeatRoute,
  "POST /api/v1/devices/diagnostics": diagnosticsRoute,
  "POST /api/v1/scans": scanRoute,
  "POST /api/v1/scans/batch": batchRoute,
} as const;

/** A device that signs every request exactly the way the firmware does. */
export class FakeDevice {
  readonly serial = `SC-TEST-${randomBytes(4).toString("hex").toUpperCase()}`;
  secret = randomBytes(32).toString("hex");

  get secretHash(): string {
    return createHash("sha256").update(this.secret).digest("hex");
  }

  async register(extra: { claim_token?: string; pairing_code?: string } = {}): Promise<Reply> {
    return toReply(
      await registerRoute(
        new Request("http://test/api/v1/devices/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ serial: this.serial, secret_hash: this.secretHash, firmware_version: "test", ...extra }),
        }),
      ),
    );
  }

  /** Mints a new secret, as a factory reset does. */
  factoryReset(): void {
    this.secret = randomBytes(32).toString("hex");
  }

  async call(
    route: keyof typeof routes,
    body?: unknown,
    opts: { key?: string; timestamp?: number; raw?: string } = {},
  ): Promise<Reply> {
    const [method, pathname] = route.split(" ") as [string, string];
    const raw = opts.raw ?? (body === undefined ? "" : JSON.stringify(body));
    const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
    const request = new Request(`http://test${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-device-id": this.serial,
        "x-timestamp": timestamp,
        "x-signature": signPayload(opts.key ?? this.secretHash, timestamp, raw),
      },
      body: method === "GET" ? undefined : raw,
    });
    return toReply(await routes[route](request));
  }

  scan(barcode: string, scanId: string = randomUUID(), extra: Record<string, unknown> = {}): Promise<Reply> {
    return this.call("POST /api/v1/scans", {
      scan_id: scanId,
      barcode,
      symbology: "EAN13",
      ts: Math.floor(Date.now() / 1000),
      ...extra,
    });
  }
}

/** Issues an app-to-device pairing code as a signed-in person would. */
export const issueClaimToken = (userId: string): Promise<string> =>
  commitAsUser(userId, async (q) => (await q<{ token: string }>(`SELECT token FROM public.create_claim_token()`))[0]!.token);
