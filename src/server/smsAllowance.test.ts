// @vitest-environment node
/**
 * Texts cost money, so the web server asks the database for an allowance
 * (reserve_sms_send) before it sends the shopping list. These run the real
 * migration as a signed-in person, the way the route reaches it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("SMS allowance", () => {
  beforeAll(() => setupTestDb("sms"), 60_000);
  afterAll(() => teardownTestDb());

  const reserve = (userId: string) =>
    commitAsUser(userId, async (q) => (await q<{ ok: boolean }>(`SELECT public.reserve_sms_send() AS ok`))[0]!.ok);

  it("lets a person send five an hour, then says no", async () => {
    const { id } = await createUser();
    for (let i = 0; i < 5; i++) expect(await reserve(id)).toBe(true);
    expect(await reserve(id)).toBe(false);
  });

  it("counts each person separately", async () => {
    const [a, b] = [await createUser(), await createUser()];
    for (let i = 0; i < 5; i++) await reserve(a.id);
    expect(await reserve(a.id)).toBe(false);
    expect(await reserve(b.id)).toBe(true);
  });

  it("frees up again as the hour passes, but never beyond twenty a day", async () => {
    const { id } = await createUser();
    for (let i = 0; i < 5; i++) await reserve(id);
    await db().query(`UPDATE public.sms_sends SET sent_at = now() - interval '2 hours' WHERE user_id = $1`, [id]);
    expect(await reserve(id)).toBe(true);
    await db().query(
      `INSERT INTO public.sms_sends (user_id, sent_at) SELECT $1, now() - interval '3 hours' FROM generate_series(1, 20)`,
      [id],
    );
    expect(await reserve(id)).toBe(false);
  });

  it("says no to a visitor who is not signed in", async () => {
    // anon has no EXECUTE on it at all, so the call is refused outright.
    await expect(asUser(null, (q) => q(`SELECT public.reserve_sms_send()`))).rejects.toThrow(/permission denied/);
  });

  it("two taps at the same moment cannot both squeeze under the limit", async () => {
    const { id } = await createUser();
    for (let i = 0; i < 4; i++) await reserve(id);
    const results = await Promise.all([reserve(id), reserve(id), reserve(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the table and its history out of a person's hands", async () => {
    const { id } = await createUser();
    await reserve(id);
    await expect(asUser(id, (q) => q(`SELECT * FROM public.sms_sends`))).rejects.toThrow(/permission denied/);
    await expect(asUser(id, (q) => q(`INSERT INTO public.sms_sends (user_id) VALUES ($1)`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(id, (q) => q(`DELETE FROM public.sms_sends`))).rejects.toThrow(/permission denied/);
  });
});
