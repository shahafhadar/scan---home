/**
 * A pretend scanner that speaks the device protocol exactly as the firmware
 * does, against any running server (local, a Vercel preview, production).
 * Lets the whole server side be checked without hardware, and tells a device
 * fault apart from a server fault when the real board misbehaves.
 *
 *   npm run fake-device -- register [CLAIM_CODE]
 *   npm run fake-device -- scan 7290000066318
 *   npm run fake-device -- heartbeat
 *   npm run fake-device -- burst      (repeat, duplicate, queue flush, forged signature)
 *
 * SCAN_HOME_URL picks the server (default http://localhost:3000). The pretend
 * device's identity is kept in .fake-device.json (git-ignored).
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.SCAN_HOME_URL ?? "http://localhost:3000";
const STATE = ".fake-device.json";

type State = { serial: string; secret: string };
const state: State = existsSync(STATE)
  ? (JSON.parse(readFileSync(STATE, "utf8")) as State)
  : (() => {
      const fresh = { serial: `SC-FAKE-${randomBytes(3).toString("hex").toUpperCase()}`, secret: randomBytes(32).toString("hex") };
      writeFileSync(STATE, JSON.stringify(fresh, null, 2));
      return fresh;
    })();
const secretHash = createHash("sha256").update(state.secret).digest("hex");

const call = async (method: string, path: string, body?: unknown, forge = false) => {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", forge ? "wrong-key" : secretHash).update(`${timestamp}.${raw}`).digest("hex");
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-device-id": state.serial, "x-timestamp": timestamp, "x-signature": signature },
    body: method === "GET" ? undefined : raw,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON, show as is
  }
  return { status: response.status, body: parsed };
};

const scan = (barcode: string, scanId = randomUUID()) =>
  call("POST", "/api/v1/scans", { scan_id: scanId, barcode, symbology: "EAN13", ts: Math.floor(Date.now() / 1000) });

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "register": {
    const response = await fetch(`${BASE}/api/v1/devices/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serial: state.serial, secret_hash: secretHash, firmware_version: "fake", claim_token: argument }),
    });
    const body = (await response.json()) as { pairing_code?: string; claimed?: boolean; status?: string };
    console.log(`server       ${BASE}`);
    console.log(`serial       ${state.serial}`);
    console.log(`status       ${body.status}${body.claimed ? " (paired now)" : ""}`);
    if (body.status !== "active") console.log(`device code  ${body.pairing_code}  <- or type this under "הסורק מציג קוד משלו?"`);
    break;
  }
  case "status":
    console.log(await call("GET", "/api/v1/devices/claim-status"));
    break;
  case "scan":
    console.log(await scan(argument ?? "7290000066318"));
    break;
  case "heartbeat":
    console.log(
      await call("POST", "/api/v1/devices/heartbeat", {
        fw: "fake",
        rssi: -58,
        scanner_attached: true,
        keys_seen: 14,
        uptime: 120,
        free_heap: 190_000,
        min_heap: 170_000,
        queue_size: 0,
      }),
    );
    break;
  case "burst": {
    console.log("scan               ", (await scan("7290000066318")).body);
    console.log("same barcode again ", (await scan("7290000066318")).body, "<- quantity should go up");
    const id = randomUUID();
    console.log("new scan_id        ", (await scan("7290004131074", id)).body);
    console.log("SAME scan_id again ", (await scan("7290004131074", id)).body, "<- must be duplicate");
    const flush = await call("POST", "/api/v1/scans/batch", {
      scans: [
        { scan_id: randomUUID(), barcode: "7290002331926", queued: true },
        { scan_id: randomUUID(), barcode: "7290011280918", queued: true },
      ],
    });
    console.log("queue flush        ", flush.body);
    const forged = await call("POST", "/api/v1/scans", { scan_id: randomUUID(), barcode: "111" }, true);
    console.log("forged signature   ", forged.status, "<- must be 401");
    break;
  }
  default:
    console.log("usage: register [CLAIM_CODE] | status | scan <barcode> | heartbeat | burst");
}
