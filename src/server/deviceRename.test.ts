// @vitest-environment node
/**
 * Renaming a device (and any other write to it) is a member action, not a
 * viewer one -- same rule issue_device_command already enforces. Runs against
 * a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeDevice, TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("device rename RBAC", () => {
  beforeAll(() => setupTestDb("rename"), 60_000);
  afterAll(() => teardownTestDb());

  const setup = async () => {
    const owner = await createUser();
    const device = new FakeDevice();
    await device.register();
    await commitAsUser(owner.id, (q) => q(`SELECT public.adopt_device($1)`, [device.serial]));
    const deviceId = (await db().query<{ id: string }>(`SELECT id FROM public.devices WHERE serial = $1`, [device.serial])).rows[0]!.id;
    return { owner, deviceId };
  };

  it("lets a member rename the device", async () => {
    const { owner, deviceId } = await setup();
    await commitAsUser(owner.id, (q) => q(`UPDATE public.devices SET name = 'מטבח' WHERE id = $1`, [deviceId]));
    const name = (await db().query<{ name: string }>(`SELECT name FROM public.devices WHERE id = $1`, [deviceId])).rows[0]!.name;
    expect(name).toBe("מטבח");
  });

  it("refuses a viewer", async () => {
    const { deviceId } = await setup();
    const hh = (await db().query<{ household_id: string }>(`SELECT household_id FROM public.devices WHERE id = $1`, [deviceId])).rows[0]!.household_id;
    const viewer = await createUser();
    await db().query(`INSERT INTO public.household_members (household_id, user_id, role) VALUES ($1, $2, 'viewer')`, [hh, viewer.id]);

    await asUser(viewer.id, async (q) => {
      await q(`UPDATE public.devices SET name = 'hacked' WHERE id = $1`, [deviceId]);
    });
    // RLS silently matches zero rows rather than raising; assert nothing changed.
    const name = (await db().query<{ name: string | null }>(`SELECT name FROM public.devices WHERE id = $1`, [deviceId])).rows[0]!.name;
    expect(name).toBeNull();
  });

  it("my_role_in reports the caller's role, or null for a non-member", async () => {
    const { owner, deviceId } = await setup();
    const hh = (await db().query<{ household_id: string }>(`SELECT household_id FROM public.devices WHERE id = $1`, [deviceId])).rows[0]!.household_id;
    const myRole = await commitAsUser(owner.id, async (q) => (await q<{ r: string }>(`SELECT public.my_role_in($1) AS r`, [hh]))[0]!.r);
    expect(myRole).toBe("owner");
    const stranger = await createUser();
    const theirRole = await commitAsUser(stranger.id, async (q) => (await q<{ r: string | null }>(`SELECT public.my_role_in($1) AS r`, [hh]))[0]!.r);
    expect(theirRole).toBeNull();
  });
});
