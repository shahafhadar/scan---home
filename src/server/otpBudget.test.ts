// @vitest-environment node
/**
 * The sign-in code budget (reserve_otp_send). Runs the real migration against a
 * throwaway Postgres, the way the Send-SMS hook reaches it. Needs
 * TEST_DATABASE_URL; skipped without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("OTP send budget", () => {
  beforeAll(() => setupTestDb("otp"), 60_000);
  afterAll(() => teardownTestDb());

  const reserve = async (identifier: string, ip: string | null = null, channel = "sms"): Promise<boolean> =>
    (await db().query<{ ok: boolean }>(`SELECT public.reserve_otp_send($1, $2, $3) AS ok`, [identifier, ip, channel]))
      .rows[0]!.ok;

  // Plant a past send so the per-identifier window can be tested without waiting.
  const planted = (identifier: string, ip: string | null, agoSeconds: number, n = 1) =>
    db().query(
      `INSERT INTO public.otp_sends (identifier_hash, ip_hash, channel, created_at)
       SELECT $1, $2, 'sms', now() - ($3 || ' seconds')::interval FROM generate_series(1, $4)`,
      [identifier, ip, agoSeconds, n],
    );

  it("allows the first request and blocks a second within 30 seconds", async () => {
    expect(await reserve("num-a")).toBe(true);
    expect(await reserve("num-a")).toBe(false);
  });

  it("allows again past the 30s cooldown, but caps at five an hour", async () => {
    await planted("num-b", null, 45); // one send 45s ago: cooldown has passed
    expect(await reserve("num-b")).toBe(true); // second in the hour
    await planted("num-c", null, 120, 5); // five in the last hour
    expect(await reserve("num-c")).toBe(false);
  });

  it("counts each identifier separately", async () => {
    expect(await reserve("num-d")).toBe(true);
    expect(await reserve("num-d")).toBe(false);
    expect(await reserve("num-e")).toBe(true);
  });

  it("stops one IP from flooding many numbers (20 an hour)", async () => {
    // 20 sends in the last hour from one IP, each a different number.
    for (let i = 0; i < 20; i++) await planted(`flood-${i}`, "ip-x", 100);
    expect(await reserve("flood-new", "ip-x")).toBe(false);
    expect(await reserve("flood-new", "ip-y")).toBe(true); // a different source is fine
  });

  it("two requests for the same number at once: only one gets through", async () => {
    const results = await Promise.all([reserve("num-race"), reserve("num-race"), reserve("num-race")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses an empty identifier", async () => {
    expect(await reserve("")).toBe(false);
  });
});
