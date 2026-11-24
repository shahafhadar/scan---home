// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  FakeDevice,
  TEST_DATABASE_URL,
  asUser,
  commitAsUser,
  createUser,
  issueClaimToken,
  setupTestDb,
  teardownTestDb,
} from "./testing";

const items = async (listId: string) =>
  (
    await db().query<{ barcode: string; name: string; quantity: number; status: string; identified: boolean }>(
      `SELECT barcode, name, quantity, status, identified FROM public.list_items WHERE list_id = $1 ORDER BY created_at`,
      [listId],
    )
  ).rows;

/** A person with a device already paired to their household. */
const pairedDevice = async () => {
  const user = await createUser();
  const device = new FakeDevice();
  const registered = await device.register({ claim_token: await issueClaimToken(user.id) });
  expect(registered.body.claimed).toBe(true);
  return { user, device };
};

describe.skipIf(!TEST_DATABASE_URL)("device protocol", () => {
  beforeAll(() => setupTestDb("protocol"), 60_000);
  afterAll(() => teardownTestDb());

  describe("authentication", () => {
    it("accepts a correctly signed scan", async () => {
      const { device } = await pairedDevice();
      const reply = await device.scan("7290000066318");
      expect(reply.status).toBe(200);
      expect(reply.body.status).toBe("added");
    });

    it("rejects a signature made with the wrong key", async () => {
      const { device, user } = await pairedDevice();
      const reply = await device.call("POST /api/v1/scans", { scan_id: randomUUID(), barcode: "111" }, { key: "f".repeat(64) });
      expect(reply.status).toBe(401);
      expect(await items(user.listId)).toHaveLength(0);
    });

    it("rejects a body changed after signing", async () => {
      const { device } = await pairedDevice();
      const signed = JSON.stringify({ scan_id: randomUUID(), barcode: "111" });
      const timestamp = Math.floor(Date.now() / 1000);
      const { signPayload } = await import("./deviceAuth");
      const request = new Request("http://test/api/v1/scans", {
        method: "POST",
        headers: {
          "x-device-id": device.serial,
          "x-timestamp": String(timestamp),
          "x-signature": signPayload(device.secretHash, String(timestamp), signed),
        },
        body: signed.replace("111", "222"),
      });
      const { POST } = await import("@/app/api/v1/scans/route");
      expect((await POST(request)).status).toBe(401);
    });

    it("rejects an unknown device", async () => {
      const stranger = new FakeDevice();
      expect((await stranger.scan("7290000066318")).status).toBe(401);
    });

    it("rejects a stale timestamp, which is how a replayed request looks", async () => {
      const { device } = await pairedDevice();
      const old = Math.floor(Date.now() / 1000) - 600;
      const reply = await device.call("POST /api/v1/scans", { scan_id: randomUUID(), barcode: "1" }, { timestamp: old });
      expect(reply.status).toBe(401);
      expect(reply.body.error).toMatch(/timestamp/);
    });

    it("rejects requests with no signature headers", async () => {
      const { POST } = await import("@/app/api/v1/scans/route");
      const response = await POST(new Request("http://test/api/v1/scans", { method: "POST", body: "{}" }));
      expect(response.status).toBe(401);
    });

    it("refuses a disabled device", async () => {
      const { device } = await pairedDevice();
      await db().query(`UPDATE public.devices SET status = 'disabled' WHERE serial = $1`, [device.serial]);
      expect((await device.scan("7290000066318")).status).toBe(403);
    });
  });

  describe("scan ingestion", () => {
    it("merges a repeat scan into a quantity instead of a second row", async () => {
      const { device, user } = await pairedDevice();
      await device.scan("7290000066318");
      const second = await device.scan("7290000066318");
      expect(second.body).toMatchObject({ status: "bumped", quantity: 2 });
      expect(await items(user.listId)).toHaveLength(1);
    });

    it("treats the same scan_id twice as one scan", async () => {
      const { device, user } = await pairedDevice();
      const id = randomUUID();
      await device.scan("7290000066318", id);
      const again = await device.scan("7290000066318", id);
      expect(again.body.status).toBe("duplicate");
      expect((await items(user.listId))[0]!.quantity).toBe(1);
    });

    it("counts a resend once even when it races the original", async () => {
      const { device, user } = await pairedDevice();
      const id = randomUUID();
      const replies = await Promise.all([1, 2, 3, 4].map(() => device.scan("7290000066318", id)));
      expect(replies.filter((r) => r.body.status === "duplicate")).toHaveLength(3);
      expect((await items(user.listId))[0]!.quantity).toBe(1);
    });

    it("merges two different scans of the same product arriving at once into one row", async () => {
      const { device, user } = await pairedDevice();
      await Promise.all([device.scan("7290000066318"), device.scan("7290000066318")]);
      const rows = await items(user.listId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.quantity).toBe(2);
    });

    it("still lists an unknown barcode rather than dropping it", async () => {
      const { device, user } = await pairedDevice();
      const reply = await device.scan("9123456789000");
      expect(reply.body).toMatchObject({ identified: false, name: "ברקוד 9123456789000" });
      expect(await items(user.listId)).toHaveLength(1);
    });

    it("names a product from the catalog, without repeating a brand the name already has", async () => {
      await db().query(
        `INSERT INTO public.products (barcode, name, brand) VALUES ('7290000000001', 'חלב 3%', 'תנובה'), ('7290000000002', 'במבה אסם', 'אסם')`,
      );
      const { device } = await pairedDevice();
      expect((await device.scan("7290000000001")).body.name).toBe("חלב 3% תנובה");
      expect((await device.scan("7290000000002")).body.name).toBe("במבה אסם");
    });

    it("finds a product printed as UPC-A when the catalog holds the EAN-13 spelling", async () => {
      await db().query(`INSERT INTO public.products (barcode, name) VALUES ('0012345678905', 'מוצר מיובא')`);
      const { device } = await pairedDevice();
      expect((await device.scan("012345678905")).body).toMatchObject({ name: "מוצר מיובא", identified: true });
    });

    it("rejects a malformed scan", async () => {
      const { device } = await pairedDevice();
      expect((await device.call("POST /api/v1/scans", { scan_id: "nope", barcode: "1" })).status).toBe(400);
      expect((await device.call("POST /api/v1/scans", undefined, { raw: "not json" })).status).toBe(400);
    });

    it("keeps the device's own scan time for queued scans", async () => {
      const { device } = await pairedDevice();
      const id = randomUUID();
      const then = Math.floor(Date.now() / 1000) - 3600;
      await device.scan("7290000066318", id, { ts: then, queued: true });
      const { rows } = await db().query(`SELECT scanned_at, was_queued FROM public.scans WHERE scan_id = $1`, [id]);
      expect(Math.floor(rows[0].scanned_at.getTime() / 1000)).toBe(then);
      expect(rows[0].was_queued).toBe(true);
    });

    it("accepts a queue flush, reports which scans it kept, and survives one bad entry", async () => {
      const { device, user } = await pairedDevice();
      const good = [randomUUID(), randomUUID()];
      const reply = await device.call("POST /api/v1/scans/batch", {
        scans: [
          { scan_id: good[0], barcode: "7290004131074", queued: true },
          { scan_id: "broken", barcode: "" },
          { scan_id: good[1], barcode: "7290002331926", queued: true },
        ],
      });
      expect(reply.status).toBe(200);
      expect(reply.body.accepted).toEqual(good);
      expect(await items(user.listId)).toHaveLength(2);
    });
  });

  describe("pairing with a code from the app", () => {
    it("claims the device the moment it registers with the code", async () => {
      const user = await createUser();
      const device = new FakeDevice();
      const reply = await device.register({ claim_token: await issueClaimToken(user.id) });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ claimed: true, status: "active" });
      const status = await device.call("GET /api/v1/devices/claim-status");
      expect(status.body).toMatchObject({ claimed: true, status: "active" });
    });

    it("binds it to the household that issued the code, and nobody else sees it", async () => {
      const { device, user } = await pairedDevice();
      const other = await createUser();
      const mine = await asUser(user.id, (q) => q(`SELECT serial FROM public.devices`));
      const theirs = await asUser(other.id, (q) => q(`SELECT serial FROM public.devices`));
      expect(mine.map((d) => d.serial)).toContain(device.serial);
      expect(theirs).toHaveLength(0);
    });

    it("refuses to let one code claim a second device", async () => {
      const user = await createUser();
      const token = await issueClaimToken(user.id);
      await new FakeDevice().register({ claim_token: token });
      const second = await new FakeDevice().register({ claim_token: token });
      expect(second.body).toMatchObject({ claimed: false, status: "unclaimed" });
    });

    it("ignores an expired code rather than pairing on it", async () => {
      const user = await createUser();
      const token = await issueClaimToken(user.id);
      await db().query(`UPDATE public.claim_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);
      const reply = await new FakeDevice().register({ claim_token: token });
      expect(reply.body).toMatchObject({ claimed: false, status: "unclaimed" });
    });

    it("still claims when the device retries because our reply was lost", async () => {
      const user = await createUser();
      const device = new FakeDevice();
      await device.register(); // first attempt, reply never arrived, no code typed yet
      const retry = await device.register({ claim_token: await issueClaimToken(user.id) });
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ claimed: true, status: "active" });
    });

    it("accepts the code in lower case, as people type it", async () => {
      const user = await createUser();
      const token = await issueClaimToken(user.id);
      const reply = await new FakeDevice().register({ claim_token: token.toLowerCase() });
      expect(reply.body.claimed).toBe(true);
    });

    it("replays scans made before pairing into the new owner's list", async () => {
      const user = await createUser();
      const device = new FakeDevice();
      await device.register();
      const held = await device.scan("7290000066318");
      expect(held.status).toBe(202);
      expect(held.body.status).toBe("held");

      await device.register({ claim_token: await issueClaimToken(user.id) });
      expect((await items(user.listId)).map((i) => i.barcode)).toEqual(["7290000066318"]);
    });

    it("puts a factory-reset device back in the box: unpaired, new code, old scans dropped", async () => {
      const { device, user } = await pairedDevice();
      const before = (await db().query(`SELECT pairing_code FROM public.devices WHERE serial = $1`, [device.serial])).rows[0];
      device.factoryReset();
      const reply = await device.register();
      expect(reply.status).toBe(200);
      expect(reply.body.status).toBe("unclaimed");
      expect(reply.body.pairing_code).not.toBe(before.pairing_code);
      // The new secret works, the previous owner no longer sees the device.
      expect((await device.call("GET /api/v1/devices/claim-status")).body.claimed).toBe(false);
      expect(await asUser(user.id, (q) => q(`SELECT 1 FROM public.devices`))).toHaveLength(0);
    });

    it("can also pair with the code the device shows, as a fallback", async () => {
      const user = await createUser();
      const device = new FakeDevice();
      const reg = await device.register({ pairing_code: "ABC234" });
      expect(reg.body.pairing_code).toBe("ABC234");
      const result = await commitAsUser(user.id, (q) => q(`SELECT public.claim_device('abc-234', 'מטבח') AS r`));
      expect(result[0]!.r).toMatchObject({ ok: true });
      expect((await device.call("GET /api/v1/devices/claim-status")).body.claimed).toBe(true);
    });

    it("will not let another household take a device that is already paired", async () => {
      const user = await createUser();
      const device = new FakeDevice();
      await device.register({ pairing_code: "XYZ234" });
      await commitAsUser(user.id, (q) => q(`SELECT public.claim_device('XYZ234')`));
      const thief = await createUser();
      const result = await commitAsUser(thief.id, (q) => q(`SELECT public.claim_device('XYZ234') AS r`));
      expect(result[0]!.r).toMatchObject({ ok: false });
    });
  });

  describe("telemetry and commands", () => {
    it("stores what the heartbeat reports and keeps a history row", async () => {
      const { device, user } = await pairedDevice();
      const reply = await device.call("POST /api/v1/devices/heartbeat", {
        fw: "1.1.2",
        rssi: -58,
        scanner_attached: true,
        keys_seen: 412,
        free_heap: 180000,
        min_heap: 150000,
        queue_size: 3,
        unknown_field: "ignored",
      });
      expect(reply.body).toMatchObject({ ok: true, claimed: true, command: null });
      const seen = await asUser(user.id, (q) =>
        q(`SELECT firmware_version, last_rssi, scanner_attached, keys_seen, queue_size, last_seen_at FROM public.devices`),
      );
      expect(seen[0]).toMatchObject({ firmware_version: "1.1.2", last_rssi: -58, scanner_attached: true, queue_size: 3 });
      const history = await asUser(user.id, (q) => q(`SELECT free_heap FROM public.device_health`));
      expect(history).toEqual([{ free_heap: 180000 }]);
    });

    it("hands the device the queued command, not the cleared column, exactly once", async () => {
      const { device } = await pairedDevice();
      await db().query(`UPDATE public.devices SET pending_command = '{"type":"reboot"}' WHERE serial = $1`, [device.serial]);
      const first = await device.call("POST /api/v1/devices/heartbeat", {});
      const second = await device.call("POST /api/v1/devices/heartbeat", {});
      expect(first.body.command).toEqual({ type: "reboot" });
      expect(second.body.command).toBeNull();
      const trail = await db().query(`SELECT last_command, last_command_sent_at FROM public.devices WHERE serial = $1`, [device.serial]);
      expect(trail.rows[0].last_command).toEqual({ type: "reboot" });
      expect(trail.rows[0].last_command_sent_at).not.toBeNull();
    });

    it("keeps diagnostics snapshots, at most twenty", async () => {
      const { device } = await pairedDevice();
      for (let i = 0; i < 22; i++) await device.call("POST /api/v1/devices/diagnostics", { i });
      const { rows } = await db().query(
        `SELECT count(*)::int AS n FROM public.device_diagnostics d JOIN public.devices v ON v.id = d.device_id WHERE v.serial = $1`,
        [device.serial],
      );
      expect(rows[0].n).toBe(20);
    });
  });

  describe("what people can and cannot reach", () => {
    it("never shows the device secret, even to its owner", async () => {
      const { user } = await pairedDevice();
      await expect(asUser(user.id, (q) => q(`SELECT secret_hash FROM public.devices`))).rejects.toThrow(/permission denied/);
      await expect(asUser(user.id, (q) => q(`SELECT pairing_code FROM public.devices`))).rejects.toThrow(/permission denied/);
    });

    it("does not let a person call the device functions directly", async () => {
      const { user } = await pairedDevice();
      await expect(
        asUser(user.id, (q) => q(`SELECT public.device_register('SC-EVIL-1', repeat('a', 64))`)),
      ).rejects.toThrow(/permission denied/);
    });

    it("keeps one household's list away from another", async () => {
      const { device, user } = await pairedDevice();
      await device.scan("7290000066318");
      const other = await createUser();
      expect(await asUser(user.id, (q) => q(`SELECT 1 FROM public.list_items`))).toHaveLength(1);
      expect(await asUser(other.id, (q) => q(`SELECT 1 FROM public.list_items`))).toHaveLength(0);
      // Nor can they write into it.
      await expect(
        asUser(other.id, (q) => q(`INSERT INTO public.list_items (list_id, name) VALUES ($1, 'x')`, [user.listId])),
      ).rejects.toThrow();
    });

    it("shows nothing at all to someone who is not signed in", async () => {
      await pairedDevice();
      await expect(asUser(null, (q) => q(`SELECT 1 FROM public.list_items`))).rejects.toThrow(/permission denied/);
      await expect(asUser(null, (q) => q(`SELECT * FROM public.create_claim_token()`))).rejects.toThrow(/permission denied/);
    });

    it("does not hand out claim tokens directly", async () => {
      const user = await createUser();
      await issueClaimToken(user.id);
      await expect(asUser(user.id, (q) => q(`SELECT token FROM public.claim_tokens`))).rejects.toThrow(/permission denied/);
    });
  });
});
