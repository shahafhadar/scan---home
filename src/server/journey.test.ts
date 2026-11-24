// @vitest-environment node
/**
 * The whole customer path, in order, the way the prototype's `dev.sh journey`
 * walked it: sign up, get a pairing code, bring a device online with it, scan,
 * teach the scanner a product, shop, go offline and catch up, and be refused
 * what should be refused. If this passes, the only untested part of a live run
 * is the hardware.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FakeDevice,
  TEST_DATABASE_URL,
  asUser,
  commitAsUser,
  createUser,
  setupTestDb,
  teardownTestDb,
} from "./testing";

type Row = Record<string, unknown>;

describe.skipIf(!TEST_DATABASE_URL)("customer journey", () => {
  beforeAll(() => setupTestDb("journey"), 60_000);
  afterAll(() => teardownTestDb());

  let user: Awaited<ReturnType<typeof createUser>>;
  let token: string;
  const device = new FakeDevice();
  const madeUp = "9" + String(Date.now()).slice(-9) + "00";
  const pendingItems = () =>
    asUser(user.id, (q) => q<Row>(`SELECT id, barcode, name, quantity FROM public.list_items WHERE status = 'pending'`));

  it("1. a new customer signs up and finds a household and an empty list ready", async () => {
    user = await createUser();
    const lists = await asUser(user.id, (q) => q<Row>(`SELECT name, is_active FROM public.lists`));
    expect(lists).toEqual([{ name: "רשימת קניות", is_active: true }]);
    expect(await pendingItems()).toHaveLength(0);
  });

  it("2. they ask the app for a pairing code", async () => {
    const rows = await commitAsUser(user.id, (q) => q<{ token: string }>(`SELECT token FROM public.create_claim_token()`));
    token = rows[0]!.token;
    expect(token).toMatch(/^[A-Z2-9]{6}$/);
  });

  it("3. the device comes online carrying that code and is paired on the spot", async () => {
    const reply = await device.register({ claim_token: token, pairing_code: "JRNY22" });
    expect(reply.body).toMatchObject({ claimed: true, status: "active" });
  });

  it("4. it shows in their device list, and reports in", async () => {
    await device.call("POST /api/v1/devices/heartbeat", { fw: "1.1.2", scanner_attached: true, free_heap: 200000 });
    const devices = await asUser(user.id, (q) => q<Row>(`SELECT serial, scanner_attached FROM public.devices`));
    expect(devices).toEqual([{ serial: device.serial, scanner_attached: true }]);
  });

  it("5. scanning the same thing twice means two of it, not two lines", async () => {
    await device.scan("7290000066318");
    const again = await device.scan("7290000066318");
    expect(again.body.quantity).toBe(2);
    expect(await pendingItems()).toHaveLength(1);
  });

  it("6. an unknown barcode still reaches the list", async () => {
    const reply = await device.scan(madeUp);
    expect(reply.body.identified).toBe(false);
  });

  it("7. naming it fixes the row already on the list", async () => {
    const rows = await commitAsUser(user.id, (q) =>
      q<{ n: number }>(`SELECT public.identify_product($1, 'מוצר שהמשתמש לימד') AS n`, [madeUp]),
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("8. and the scanner knows it next time", async () => {
    const reply = await device.scan(madeUp);
    expect(reply.body.name).toBe("מוצר שהמשתמש לימד");
  });

  it("9. the list holds two products with the right quantities", async () => {
    const items = await pendingItems();
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.barcode === "7290000066318")?.quantity).toBe(2);
    expect(items.find((i) => i.barcode === madeUp)?.quantity).toBe(2);
  });

  it("10. an item can be added by hand and ticked off in the shop", async () => {
    await commitAsUser(user.id, async (q) => {
      const [list] = await q<{ id: string }>(`SELECT id FROM public.lists WHERE is_active`);
      await q(`INSERT INTO public.list_items (list_id, name) VALUES ($1, 'עגבניות')`, [list!.id]);
      await q(`UPDATE public.list_items SET status = 'purchased' WHERE barcode = '7290000066318'`);
    });
    const names = (await pendingItems()).map((i) => i.name);
    expect(names).toContain("עגבניות");
    expect(names).not.toContain("ברקוד 7290000066318");
  });

  it("11. a scan after ticking off starts a fresh line instead of reviving the bought one", async () => {
    const reply = await device.scan("7290000066318");
    expect(reply.body).toMatchObject({ status: "added", quantity: 1 });
  });

  it("12. a scanner that was offline flushes its queue and the server confirms each scan", async () => {
    const reply = await device.call("POST /api/v1/scans/batch", {
      scans: [
        { scan_id: randomUUID(), barcode: "7290004131074", queued: true },
        { scan_id: randomUUID(), barcode: "7290002331926", queued: true },
      ],
    });
    expect((reply.body.accepted as string[]).length).toBe(2);
  });

  it("13. a resend after a dropped reply cannot double an item", async () => {
    const id = randomUUID();
    await device.scan("7290011280918", id);
    expect((await device.scan("7290011280918", id)).body.status).toBe("duplicate");
  });

  it("14. a forged signature is rejected", async () => {
    const reply = await device.call("POST /api/v1/scans", { scan_id: randomUUID(), barcode: "111" }, { key: "ff".repeat(32) });
    expect(reply.status).toBe(401);
  });

  it("15. the pairing code cannot claim a second device", async () => {
    const reply = await new FakeDevice().register({ claim_token: token });
    expect(reply.body.status).toBe("unclaimed");
  });

  it("16. another customer sees none of it", async () => {
    const stranger = await createUser();
    expect(await asUser(stranger.id, (q) => q(`SELECT 1 FROM public.list_items`))).toHaveLength(0);
    expect(await asUser(stranger.id, (q) => q(`SELECT 1 FROM public.devices`))).toHaveLength(0);
  });

  it("17. the list is not readable without signing in", async () => {
    await expect(asUser(null, (q) => q(`SELECT 1 FROM public.list_items`))).rejects.toThrow();
  });
});
