// @vitest-environment node
/**
 * Self-service account deletion (delete_my_account): a person can close their
 * own account and loses access at once; a visitor cannot call it; it is
 * idempotent. Runs the real migrations against a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("account deletion", () => {
  beforeAll(() => setupTestDb("del"), 60_000);
  afterAll(() => teardownTestDb());

  const statusOf = async (userId: string) =>
    (await db().query<{ status: string }>(`SELECT status FROM public.profiles WHERE user_id = $1`, [userId])).rows[0]
      ?.status;

  it("lets a person close their own account, and cuts off access", async () => {
    const { id } = await createUser();
    await commitAsUser(id, (q) => q(`SELECT public.delete_my_account()`));
    expect(await statusOf(id)).toBe("deleted");
    const listsVisible = await asUser(id, async (q) => (await q(`SELECT id FROM public.lists`)).length);
    expect(listsVisible).toBe(0);
  });

  it("refuses a visitor who is not signed in", async () => {
    await expect(asUser(null, (q) => q(`SELECT public.delete_my_account()`))).rejects.toThrow(/permission denied/);
  });

  it("is idempotent", async () => {
    const { id } = await createUser();
    await commitAsUser(id, (q) => q(`SELECT public.delete_my_account()`));
    await commitAsUser(id, (q) => q(`SELECT public.delete_my_account()`));
    expect(await statusOf(id)).toBe("deleted");
  });
});
