// @vitest-environment node
/**
 * Account state: a non-active account is cut off from every household table,
 * status is an operator-only change, and a person can see only their own
 * profile. Runs the real migrations against a throwaway Postgres; needs
 * TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, asUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("account status", () => {
  beforeAll(() => setupTestDb("status"), 60_000);
  afterAll(() => teardownTestDb());

  const setStatus = (userId: string, status: string) =>
    db().query(`SELECT public.set_account_status($1, $2::public.account_status)`, [userId, status]);

  const listsVisibleTo = (userId: string) =>
    asUser(userId, async (q) => (await q<{ id: string }>(`SELECT id FROM public.lists`)).length);

  const isActive = (userId: string) =>
    asUser(userId, async (q) => (await q<{ ok: boolean }>(`SELECT public.is_active_user() AS ok`))[0]!.ok);

  it("gives every new account an active profile", async () => {
    const { id } = await createUser();
    const rows = await db().query<{ status: string }>(`SELECT status FROM public.profiles WHERE user_id = $1`, [id]);
    expect(rows.rows[0]?.status).toBe("active");
    expect(await isActive(id)).toBe(true);
  });

  it("an active member sees their household's list", async () => {
    const { id } = await createUser();
    expect(await listsVisibleTo(id)).toBe(1);
  });

  it("a suspended account is cut off from household data at the database", async () => {
    const { id } = await createUser();
    await setStatus(id, "suspended");
    expect(await listsVisibleTo(id)).toBe(0); // my_household_ids() now returns nothing
    expect(await isActive(id)).toBe(false);
  });

  it("the same cut-off applies to disabled and deleted", async () => {
    for (const status of ["disabled", "deleted"]) {
      const { id } = await createUser();
      await setStatus(id, status);
      expect(await listsVisibleTo(id)).toBe(0);
    }
  });

  it("restoring to active gives access back", async () => {
    const { id } = await createUser();
    await setStatus(id, "suspended");
    await setStatus(id, "active");
    expect(await listsVisibleTo(id)).toBe(1);
  });

  it("a signed-in person cannot change status, their own or anyone's", async () => {
    const { id } = await createUser();
    await expect(asUser(id, (q) => q(`SELECT public.set_account_status($1, 'active')`, [id]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a person sees only their own profile, and cannot edit it", async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect(await asUser(a.id, async (q) => (await q(`SELECT user_id FROM public.profiles`)).length)).toBe(1);
    expect(
      await asUser(a.id, async (q) => (await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [b.id])).length),
    ).toBe(0);
    await expect(
      asUser(a.id, (q) => q(`UPDATE public.profiles SET status = 'active' WHERE user_id = $1`, [a.id])),
    ).rejects.toThrow(/permission denied/);
  });
});
