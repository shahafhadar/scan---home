// @vitest-environment node
/**
 * Adopt-by-serial: a freshly registered device can be adopted with one tap,
 * replaying the scans it made while unclaimed; a stale one cannot; first
 * adopter wins; it is idempotent, audited, and closed to anonymous callers.
 * Uses the fake device (the firmware's protocol) against a throwaway Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeDevice, TEST_DATABASE_URL, asUser, commitAsUser, createUser, setupTestDb, teardownTestDb } from "./testing";
import { db } from "./db";

type AdoptResult = { ok: boolean; error?: string; device_id?: string; replayed_scans?: number };

describe.skipIf(!TEST_DATABASE_URL)("device adoption", () => {
  beforeAll(() => setupTestDb("adopt"), 60_000);
  afterAll(() => teardownTestDb());

  const adoptableSerials = (userId: string): Promise<string[]> =>
    commitAsUser(userId, async (q) =>
      (await q<{ serial: string }>(`SELECT serial FROM public.list_adoptable_devices()`)).map((r) => r.serial),
    );

  const adopt = (userId: string, serial: string): Promise<AdoptResult> =>
    commitAsUser(userId, async (q) => (await q<{ r: AdoptResult }>(`SELECT public.adopt_device($1) AS r`, [serial]))[0]!.r);

  it("adopts a freshly registered device and replays its held scans", async () => {
    const { id } = await createUser();
    const device = new FakeDevice();
    await device.register();
    await device.scan("7290000066318"); // recorded while unclaimed, held

    expect(await adoptableSerials(id)).toContain(device.serial);

    const result = await adopt(id, device.serial);
    expect(result.ok).toBe(true);
    expect(result.replayed_scans).toBe(1);

    const dev = (
      await db().query<{ status: string; household_id: string | null }>(
        `SELECT status, household_id FROM public.devices WHERE serial = $1`,
        [device.serial],
      )
    ).rows[0]!;
    expect(dev.status).toBe("active");
    expect(dev.household_id).not.toBeNull();

    const items = await commitAsUser(id, async (q) => (await q(`SELECT name FROM public.list_items`)).length);
    expect(items).toBe(1); // the held scan landed on the list
  });

  it("does not offer or adopt a device that was not seen recently", async () => {
    const device = new FakeDevice();
    await device.register();
    await db().query(`UPDATE public.devices SET created_at = now() - interval '2 hours', last_seen_at = NULL WHERE serial = $1`, [
      device.serial,
    ]);
    const { id } = await createUser();
    expect(await adoptableSerials(id)).not.toContain(device.serial);
    expect((await adopt(id, device.serial)).ok).toBe(false);
  });

  it("gives the device to the first adopter only", async () => {
    const device = new FakeDevice();
    await device.register();
    const [a, b] = [await createUser(), await createUser()];
    expect((await adopt(a.id, device.serial)).ok).toBe(true);
    const second = await adopt(b.id, device.serial);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/כבר משויך/);
  });

  it("is idempotent for the household that already owns it", async () => {
    const device = new FakeDevice();
    await device.register();
    const { id } = await createUser();
    expect((await adopt(id, device.serial)).ok).toBe(true);
    expect((await adopt(id, device.serial)).ok).toBe(true);
  });

  it("records an audit event for each adoption", async () => {
    const device = new FakeDevice();
    await device.register();
    const { id } = await createUser();
    await adopt(id, device.serial);
    const { rows } = await db().query(
      `SELECT 1 FROM public.security_events WHERE event = 'device_adopted' AND user_id = $1`,
      [id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("is closed to anonymous callers", async () => {
    await expect(asUser(null, (q) => q(`SELECT public.list_adoptable_devices()`))).rejects.toThrow(/permission denied/);
    await expect(asUser(null, (q) => q(`SELECT public.adopt_device('SC-TEST-0000')`))).rejects.toThrow(/permission denied/);
  });
});
