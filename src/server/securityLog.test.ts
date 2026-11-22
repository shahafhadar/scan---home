// @vitest-environment node
/**
 * The security-event trail: events are recorded, operator status changes leave
 * a trace, and no signed-in person can read the table. Runs the real migrations
 * against a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, asUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";
import { recordSecurityEvent } from "./securityLog";

describe.skipIf(!TEST_DATABASE_URL)("security events", () => {
  beforeAll(() => setupTestDb("sec"), 60_000);
  afterAll(() => teardownTestDb());

  it("records an event", async () => {
    await recordSecurityEvent("account_exported", { userId: null, meta: { note: "test" } });
    const { rows } = await db().query(`SELECT event FROM public.security_events WHERE event = 'account_exported'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("leaves a trail when an operator changes a status", async () => {
    const { id } = await createUser();
    await db().query(`SELECT public.set_account_status($1, 'suspended')`, [id]);
    const { rows } = await db().query(
      `SELECT 1 FROM public.security_events WHERE event = 'account_status_changed' AND user_id = $1`,
      [id],
    );
    expect(rows.length).toBe(1);
  });

  it("is out of a signed-in person's reach", async () => {
    const { id } = await createUser();
    await expect(asUser(id, (q) => q(`SELECT * FROM public.security_events`))).rejects.toThrow(/permission denied/);
  });
});
