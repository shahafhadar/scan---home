// @vitest-environment node
/**
 * Remote command lifecycle: an authorised member issues a command, the device
 * picks it up once on a heartbeat (pending -> sent), reports the outcome on the
 * next (-> done), stale commands expire and are never delivered, viewers and
 * non-members cannot issue, and only household members can see a command.
 * Driven by the fake device against a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeDevice, TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

describe.skipIf(!TEST_DATABASE_URL)("device commands", () => {
  beforeAll(() => setupTestDb("commands"), 60_000);
  afterAll(() => teardownTestDb());

  const setup = async () => {
    const { id: userId } = await createUser();
    const device = new FakeDevice();
    await device.register();
    await commitAsUser(userId, (q) => q(`SELECT public.adopt_device($1)`, [device.serial]));
    const { rows } = await db().query<{ id: string; household_id: string }>(
      `SELECT id, household_id FROM public.devices WHERE serial = $1`,
      [device.serial],
    );
    return { userId, device, deviceId: rows[0]!.id, householdId: rows[0]!.household_id };
  };

  const issue = (userId: string, deviceId: string, type = "locate"): Promise<string> =>
    commitAsUser(
      userId,
      async (q) => (await q<{ id: string }>(`SELECT public.issue_device_command($1, $2) AS id`, [deviceId, type]))[0]!.id,
    );

  const statusOf = async (id: string): Promise<string | undefined> =>
    (await db().query<{ status: string }>(`SELECT status FROM public.device_commands WHERE id = $1`, [id])).rows[0]?.status;

  it("delivers a command once, then records the device's ack", async () => {
    const { userId, device, deviceId } = await setup();
    const id = await issue(userId, deviceId);
    expect(await statusOf(id)).toBe("pending");

    const delivered = await device.call("POST /api/v1/devices/heartbeat", { free_heap: 1000 });
    expect((delivered.body.command as { id?: string })?.id).toBe(id); // handed to the device
    expect(await statusOf(id)).toBe("sent");

    await device.call("POST /api/v1/devices/heartbeat", { command_ack: { id, status: "done" } });
    expect(await statusOf(id)).toBe("done");
  });

  it("never delivers an expired command", async () => {
    const { userId, device, deviceId } = await setup();
    const id = await issue(userId, deviceId);
    await db().query(`UPDATE public.device_commands SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);

    const beat = await device.call("POST /api/v1/devices/heartbeat", { free_heap: 1000 });
    expect(beat.body.command).toBeNull();
    expect(await statusOf(id)).toBe("expired");
  });

  it("keeps the ack idempotent", async () => {
    const { userId, device, deviceId } = await setup();
    const id = await issue(userId, deviceId);
    await device.call("POST /api/v1/devices/heartbeat", {});
    await device.call("POST /api/v1/devices/heartbeat", { command_ack: { id, status: "done" } });
    await device.call("POST /api/v1/devices/heartbeat", { command_ack: { id, status: "failed" } });
    expect(await statusOf(id)).toBe("done");
  });

  it("refuses a viewer and a non-member", async () => {
    const { deviceId, householdId } = await setup();
    const viewer = await createUser();
    await db().query(`INSERT INTO public.household_members (household_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      householdId,
      viewer.id,
    ]);
    await expect(issue(viewer.id, deviceId)).rejects.toThrow(/viewers cannot/);

    const stranger = await createUser();
    await expect(issue(stranger.id, deviceId)).rejects.toThrow(/not a member/);
  });

  it("shows a command to a member but not to an outsider", async () => {
    const { userId, deviceId } = await setup();
    await issue(userId, deviceId);
    const mine = await commitAsUser(userId, async (q) => (await q(`SELECT id FROM public.device_commands`)).length);
    expect(mine).toBeGreaterThanOrEqual(1);
    const stranger = await createUser();
    const theirs = await asUser(stranger.id, async (q) => (await q(`SELECT id FROM public.device_commands`)).length);
    expect(theirs).toBe(0);
  });
});
