import { createHmac, timingSafeEqual } from "node:crypto";
import { one } from "./db";

export type Device = {
  id: string;
  serial: string;
  household_id: string | null;
  status: "unclaimed" | "active" | "disabled";
  pairing_code: string;
};

/**
 * The wire protocol the ESP32 firmware already speaks, unchanged:
 *
 *   X-Device-Id:  the device serial
 *   X-Timestamp:  unix seconds
 *   X-Signature:  hex HMAC-SHA256 over `${timestamp}.${raw body}`, keyed with
 *                 sha256(device secret) -- the value the server stores.
 *
 * The secret never crosses the network after registration, and a captured
 * request stops working once the timestamp leaves the window. A resend inside
 * the window is harmless: scans carry their own id and are deduplicated.
 */
export const signPayload = (key: string, timestamp: string, body: string): string =>
  createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");

// Generous enough for a device with mild clock drift.
export const MAX_SKEW_SECONDS = 300;

export type DeviceAuthResult =
  | { ok: true; device: Device }
  | { ok: false; status: number; error: string };

export const authenticateDevice = async (request: Request, rawBody: string): Promise<DeviceAuthResult> => {
  const serial = request.headers.get("x-device-id");
  const timestamp = request.headers.get("x-timestamp");
  const signature = request.headers.get("x-signature");

  if (!serial || !timestamp || !signature) {
    return { ok: false, status: 401, error: "missing device auth headers" };
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!/^\d{1,12}$/.test(timestamp) || !Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) {
    // Almost always a device that has not synced its clock yet.
    return { ok: false, status: 401, error: "timestamp outside accepted window" };
  }

  const row = await one<Device & { secret_hash: string }>(
    `SELECT id, serial, secret_hash, household_id, status, pairing_code FROM public.devices WHERE serial = $1`,
    [serial],
  );
  if (!row) return { ok: false, status: 401, error: "unknown device" };

  const expected = Buffer.from(signPayload(row.secret_hash, timestamp, rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: "bad signature" };
  }
  if (row.status === "disabled") return { ok: false, status: 403, error: "device disabled" };

  const { secret_hash: _secret, ...device } = row;
  void _secret;
  return { ok: true, device };
};

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });
