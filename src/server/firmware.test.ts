// @vitest-environment node
import { generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as uploadRoute } from "@/app/api/v1/firmware/releases/route";
import { db } from "./db";
import { FIRMWARE_PUBLIC_KEY_PEM, MAX_IMAGE_BYTES, parseImageTag, sha256Hex, useFirmwareKeyForTests } from "./firmware";
import { FakeDevice, TEST_DATABASE_URL, setupTestDb, teardownTestDb } from "./testing";

const HOST = "http://test";

/** Bytes shaped like a firmware image: noise, the tag (NUL-terminated), noise. */
const makeImage = (version: string, tag: { build?: string; hw: string; host?: string }): Buffer =>
  Buffer.concat([
    randomBytes(2048),
    Buffer.from(`SCANCART-IMAGE|fw=${version}|build=${tag.build ?? "usb"}|hw=${tag.hw}|host=${tag.host ?? HOST}|\0`, "latin1"),
    randomBytes(2048),
  ]);

describe("firmware image tag", () => {
  it("reads what the image says about itself", () => {
    expect(parseImageTag(makeImage("1.3.1", { hw: "esp32s3-devkitc1-n16r8", host: "https://scan.example" }))).toEqual({
      version: "1.3.1",
      build: "usb",
      hw: "esp32s3-devkitc1-n16r8",
      host: "https://scan.example",
    });
  });

  it("refuses a missing, repeated or malformed tag", () => {
    expect(parseImageTag(randomBytes(4096))).toBeNull();
    const one = makeImage("1.3.1", { hw: "a" });
    expect(parseImageTag(Buffer.concat([one, one]))).toBeNull();
    expect(parseImageTag(makeImage("1.3", { hw: "a" }))).toBeNull();
    expect(parseImageTag(makeImage("1.3.1", { hw: "a", build: "USB!" }))).toBeNull();
    expect(parseImageTag(makeImage("1.3.1", { hw: "a", host: "https://x.example/path" }))).toBeNull();
    expect(parseImageTag(Buffer.from("SCANCART-IMAGE|fw=1.3.1|build=usb|hw=a|host=https://x.example", "latin1"))).toBeNull();
  });

  it("checks uploads against the very key the firmware compiles in", () => {
    const header = readFileSync(path.resolve(__dirname, "../../firmware/src/ota/ota_public_key.h"), "utf8");
    const pem = [...header.matchAll(/^\s*"(.*)\\n"/gm)].map((m) => m[1]).join("\n") + "\n";
    expect(pem).toContain("BEGIN PUBLIC KEY");
    expect(FIRMWARE_PUBLIC_KEY_PEM).toBe(pem);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("firmware releases", () => {
  let privateKey: KeyObject;

  beforeAll(async () => {
    await setupTestDb("firmware");
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    privateKey = pair.privateKey;
    useFirmwareKeyForTests(pair.publicKey.export({ type: "spki", format: "pem" }).toString());
  }, 60_000);
  afterAll(async () => {
    useFirmwareKeyForTests(null);
    await teardownTestDb();
  });

  const signImage = (image: Buffer, key: KeyObject = privateKey): Buffer =>
    sign("sha256", image, { key, dsaEncoding: "der" });

  const upload = async (image: Buffer, signature = signImage(image), origin = HOST) => {
    const response = await uploadRoute(
      new Request(`${origin}/api/v1/firmware/releases`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-firmware-signature": signature.toString("base64") },
        body: new Uint8Array(image),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  const release = async (version: string, hw: string, rollout = 100, build = "usb") => {
    const image = makeImage(version, { hw, build });
    const { status, body } = await upload(image);
    expect(status).toBe(201);
    await db().query(`UPDATE public.firmware_releases SET rollout_percent = $2 WHERE id = $1`, [body.id, rollout]);
    return { id: body.id as string, image };
  };

  /** A device that has reported itself: version, board and build. */
  const deviceOn = async (fw: string, hw: string, build = "usb") => {
    const device = new FakeDevice();
    await device.register();
    const beat = await device.call("POST /api/v1/devices/heartbeat", { fw, hw, build, ota: { state: "idle" } });
    expect(beat.status).toBe(200);
    return device;
  };

  const offerFor = async (device: FakeDevice, extra: Record<string, unknown> = {}) =>
    (await device.call("POST /api/v1/devices/heartbeat", { ota: { state: "idle" }, ...extra })).body.update as
      | { version: string; path: string; size: number; sha256: string }
      | null;

  const bucketOf = async (device: FakeDevice) =>
    (
      await db().query<{ bucket: number }>(
        `SELECT (abs(hashtext(id::text)::bigint) % 100)::int AS bucket FROM public.devices WHERE serial = $1`,
        [device.serial],
      )
    ).rows[0]!.bucket;

  const hw = () => `hw-${randomUUID().slice(0, 8)}`;

  describe("upload", () => {
    it("accepts a signed image as a draft that nobody is offered", async () => {
      const board = hw();
      const image = makeImage("1.3.1", { hw: board });
      const { status, body } = await upload(image);
      expect(status).toBe(201);
      expect(body).toMatchObject({ version: "1.3.1", build: "usb", hw: board, rollout_percent: 0 });

      const stored = await db().query(`SELECT size, sha256, host FROM public.firmware_releases WHERE id = $1`, [body.id]);
      expect(stored.rows[0]).toEqual({ size: image.length, sha256: sha256Hex(image), host: HOST });

      expect(await offerFor(await deviceOn("1.3.0", board))).toBeNull();
    });

    it("refuses an image signed with any other key", async () => {
      const image = makeImage("1.3.1", { hw: hw() });
      const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
      expect((await upload(image, signImage(image, stranger))).status).toBe(400);
      expect((await upload(image, randomBytes(70))).status).toBe(400);
      expect((await upload(image, Buffer.alloc(0))).status).toBe(400);
    });

    it("refuses an image built for a different server", async () => {
      const image = makeImage("1.3.1", { hw: hw(), host: "https://production.example" });
      const { status, body } = await upload(image);
      expect(status).toBe(400);
      expect(body.error).toMatch(/not this server/);
    });

    it("refuses an image without a tag, a duplicate, and one too big to install", async () => {
      const untagged = randomBytes(4096);
      expect((await upload(untagged)).status).toBe(400);

      const image = makeImage("1.3.1", { hw: hw() });
      expect((await upload(image)).status).toBe(201);
      expect((await upload(image)).status).toBe(409);

      const huge = Buffer.concat([makeImage("1.3.1", { hw: hw() }), Buffer.alloc(MAX_IMAGE_BYTES)]);
      expect((await upload(huge)).status).toBe(413);
    });
  });

  describe("offers", () => {
    it("offers a published newer release, with what the device needs to check it", async () => {
      const board = hw();
      const { id, image } = await release("1.3.1", board);
      const update = await offerFor(await deviceOn("1.3.0", board));
      expect(update).toEqual({ version: "1.3.1", path: `/api/v1/firmware/${id}.bin`, size: image.length, sha256: sha256Hex(image) });
    });

    it("offers only newer versions, compared as numbers", async () => {
      const board = hw();
      await release("1.10.0", board);
      expect((await offerFor(await deviceOn("1.9.5", board)))?.version).toBe("1.10.0");
      expect(await offerFor(await deviceOn("1.10.0", board))).toBeNull();
      expect(await offerFor(await deviceOn("2.0.0", board))).toBeNull();
    });

    it("offers the highest version that applies", async () => {
      const board = hw();
      await release("1.3.1", board);
      await release("1.3.3", board);
      await release("1.3.2", board);
      expect((await offerFor(await deviceOn("1.3.0", board)))?.version).toBe("1.3.3");
    });

    it("never crosses builds or boards", async () => {
      const board = hw();
      await release("1.3.1", board, 100, "usb");
      expect(await offerFor(await deviceOn("1.3.0", board, "uart"))).toBeNull();
      expect(await offerFor(await deviceOn("1.3.0", hw(), "usb"))).toBeNull();
    });

    it("never offers a pulled release", async () => {
      const board = hw();
      await release("1.3.1", board);
      const { id } = await release("1.3.2", board);
      await db().query(`UPDATE public.firmware_releases SET yanked = true WHERE id = $1`, [id]);
      expect((await offerFor(await deviceOn("1.3.0", board)))?.version).toBe("1.3.1");
    });

    it("never offers a version the device rolled back from, even after it stops saying so", async () => {
      const board = hw();
      await release("1.3.1", board);
      await release("1.3.2", board);
      const device = await deviceOn("1.3.0", board);

      expect((await offerFor(device, { ota: { state: "idle", rejected: "1.3.2" } }))?.version).toBe("1.3.1");
      expect((await offerFor(device, { ota: { state: "idle" } }))?.version).toBe("1.3.1");
    });

    it("respects the rollout: a device's bucket is fixed, and below the percentage it is in", async () => {
      const board = hw();
      const device = await deviceOn("1.3.0", board);
      const bucket = await bucketOf(device);
      const { id } = await release("1.3.1", board, bucket);
      expect(await offerFor(device)).toBeNull();
      await db().query(`UPDATE public.firmware_releases SET rollout_percent = $2 WHERE id = $1`, [id, bucket + 1]);
      expect((await offerFor(device))?.version).toBe("1.3.1");
    });

    it("offers nothing to a device whose version does not parse", async () => {
      const board = hw();
      await release("1.3.1", board);
      expect(await offerFor(await deviceOn("dev-build", board))).toBeNull();
    });
  });

  describe("download", () => {
    it("serves the image and its signature to a device it was offered to", async () => {
      const board = hw();
      const { id, image } = await release("1.3.1", board);
      const device = await deviceOn("1.3.0", board);

      const bin = await device.download(`${id}.bin`);
      expect(bin.status).toBe(200);
      expect(bin.length).toBe(String(image.length));
      expect(bin.bytes.equals(image)).toBe(true);

      const sig = await device.download(`${id}.bin.sig`);
      expect(sig.status).toBe(200);
      expect(sig.bytes.equals(signImage(image))).toBe(false); // ECDSA is randomised...
      const stored = await db().query<{ signature: Buffer }>(`SELECT signature FROM public.firmware_releases WHERE id = $1`, [id]);
      expect(sig.bytes.equals(stored.rows[0]!.signature)).toBe(true); // ...so compare with what was uploaded
    });

    it("refuses an unsigned request, another build, a pulled release and a made-up name", async () => {
      const board = hw();
      const { id } = await release("1.3.1", board);
      const device = await deviceOn("1.3.0", board);

      expect((await device.download(`${id}.bin`, { sign: false })).status).toBe(401);
      expect((await (await deviceOn("1.3.0", board, "uart")).download(`${id}.bin`)).status).toBe(404);
      expect((await device.download(`${randomUUID()}.bin`)).status).toBe(404);
      expect((await device.download(`${id}.exe`)).status).toBe(404);

      await db().query(`UPDATE public.firmware_releases SET yanked = true WHERE id = $1`, [id]);
      expect((await device.download(`${id}.bin`)).status).toBe(404);
    });
  });

  describe("heartbeat", () => {
    it("records the build and where updating stands", async () => {
      const board = hw();
      const device = await deviceOn("1.3.0", board);
      await device.call("POST /api/v1/devices/heartbeat", {
        ota: { state: "failed", target: "1.3.1", error: "stalled at 81920" },
      });
      const row = async () =>
        (
          await db().query(
            `SELECT firmware_build, ota_state, ota_target_version, ota_error, ota_rejected_version, ota_updated_at
               FROM public.devices WHERE serial = $1`,
            [device.serial],
          )
        ).rows[0]!;
      const failed = await row();
      expect(failed).toMatchObject({ firmware_build: "usb", ota_state: "failed", ota_target_version: "1.3.1", ota_error: "stalled at 81920" });

      // Same state again: the timestamp says when it changed, not when it was last seen.
      await device.call("POST /api/v1/devices/heartbeat", { ota: { state: "failed", target: "1.3.1", error: "stalled at 81920" } });
      expect((await row()).ota_updated_at).toEqual(failed.ota_updated_at);

      await device.call("POST /api/v1/devices/heartbeat", { ota: { state: "idle", rejected: "1.3.1" } });
      expect(await row()).toMatchObject({ ota_state: "idle", ota_target_version: null, ota_error: null, ota_rejected_version: "1.3.1" });
    });

    it("still accepts a beat from firmware that knows nothing about updates", async () => {
      const device = new FakeDevice();
      await device.register();
      const beat = await device.call("POST /api/v1/devices/heartbeat", { fw: "1.2.0", rssi: -50 });
      expect(beat.status).toBe(200);
      expect(beat.body.update).toBeNull();
    });
  });
});
