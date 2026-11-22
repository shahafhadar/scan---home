// @vitest-environment node
/**
 * Household sharing: an owner invites by e-mail, the invited person accepts,
 * roles can change and members can be removed, a household always keeps an
 * owner, and an owner can release a device for sale. Authorisation is enforced
 * throughout. Runs against a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeDevice, TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

const email = (id: string) => `${id}@example.test`;

describe.skipIf(!TEST_DATABASE_URL)("household sharing", () => {
  beforeAll(() => setupTestDb("sharing"), 60_000);
  afterAll(() => teardownTestDb());

  const invite = (owner: string, hh: string, toEmail: string, role = "member"): Promise<string> =>
    commitAsUser(
      owner,
      async (q) => (await q<{ t: string }>(`SELECT public.create_household_invite($1, $2, $3::public.member_role) AS t`, [hh, toEmail, role]))[0]!.t,
    );
  const accept = (user: string, token: string): Promise<{ ok: boolean; error?: string; household_id?: string }> =>
    commitAsUser(user, async (q) => (await q<{ r: { ok: boolean } }>(`SELECT public.accept_household_invite($1) AS r`, [token]))[0]!.r);
  const roleOf = async (hh: string, user: string): Promise<string | undefined> =>
    (await db().query<{ role: string }>(`SELECT role FROM public.household_members WHERE household_id = $1 AND user_id = $2`, [hh, user])).rows[0]?.role;

  it("an owner invites and the invited person joins with the role", async () => {
    const a = await createUser();
    const b = await createUser();
    const token = await invite(a.id, a.householdId, email(b.id), "member");
    const r = await accept(b.id, token);
    expect(r.ok).toBe(true);
    expect(r.household_id).toBe(a.householdId);
    expect(await roleOf(a.householdId, b.id)).toBe("member");
    // b now sees the shared household's list (plus their own).
    const lists = await asUser(b.id, async (q) => (await q<{ household_id: string }>(`SELECT household_id FROM public.lists`)).map((l) => l.household_id));
    expect(lists).toContain(a.householdId);
  });

  it("rejects acceptance from a different e-mail, and a non-owner inviting", async () => {
    const a = await createUser();
    const b = await createUser();
    const token = await invite(a.id, a.householdId, "someone@else.test");
    expect((await accept(b.id, token)).ok).toBe(false);

    // b joins as a member, then cannot invite.
    const t2 = await invite(a.id, a.householdId, email(b.id));
    await accept(b.id, t2);
    await expect(invite(b.id, a.householdId, "x@y.test")).rejects.toThrow(/only an owner/);
  });

  it("never removes or demotes the last owner", async () => {
    const a = await createUser();
    await expect(
      commitAsUser(a.id, (q) => q(`SELECT public.set_member_role($1, $2, 'member')`, [a.householdId, a.id])),
    ).rejects.toThrow(/keep an owner/);
    await expect(
      commitAsUser(a.id, (q) => q(`SELECT public.remove_household_member($1, $2)`, [a.householdId, a.id])),
    ).rejects.toThrow(/keep an owner/);
  });

  it("an owner removes a member, who then loses access", async () => {
    const a = await createUser();
    const b = await createUser();
    await accept(b.id, await invite(a.id, a.householdId, email(b.id)));
    await commitAsUser(a.id, (q) => q(`SELECT public.remove_household_member($1, $2)`, [a.householdId, b.id]));
    expect(await roleOf(a.householdId, b.id)).toBeUndefined();
    const lists = await asUser(b.id, async (q) => (await q<{ household_id: string }>(`SELECT household_id FROM public.lists`)).map((l) => l.household_id));
    expect(lists).not.toContain(a.householdId);
  });

  it("releases a device only for an owner", async () => {
    const a = await createUser();
    const device = new FakeDevice();
    await device.register();
    await commitAsUser(a.id, (q) => q(`SELECT public.adopt_device($1)`, [device.serial]));
    const deviceId = (await db().query<{ id: string }>(`SELECT id FROM public.devices WHERE serial = $1`, [device.serial])).rows[0]!.id;

    const stranger = await createUser();
    await expect(commitAsUser(stranger.id, (q) => q(`SELECT public.release_device($1)`, [deviceId]))).rejects.toThrow(/only an owner/);

    await commitAsUser(a.id, (q) => q(`SELECT public.release_device($1)`, [deviceId]));
    const dev = (await db().query<{ status: string; household_id: string | null }>(`SELECT status, household_id FROM public.devices WHERE id = $1`, [deviceId])).rows[0]!;
    expect(dev.status).toBe("unclaimed");
    expect(dev.household_id).toBeNull();
  });
});
