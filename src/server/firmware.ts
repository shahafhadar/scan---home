import { createHash, verify } from "node:crypto";

/**
 * The public half of the firmware signing key -- the same PEM the firmware
 * compiles in (firmware/src/ota/ota_public_key.h; a test keeps the two equal).
 * The server checks uploads against it so it never stores an image a device
 * would refuse, and so that the signature itself is what authorises an upload:
 * only the holder of the private key can publish firmware.
 */
export const FIRMWARE_PUBLIC_KEY_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExx5bqzB/V7bFZrcGv2LaZmumZ95C",
  "Ag3rSGhpM3xYmHERTUoqIkUNFvp2JXqBdBM8ZzPD+C2qDywSVIzRe4xh2g==",
  "-----END PUBLIC KEY-----",
  "",
].join("\n");

let publicKey = FIRMWARE_PUBLIC_KEY_PEM;

/** Tests sign with a key of their own. Refused outside the test runner. */
export const useFirmwareKeyForTests = (pem: string | null): void => {
  if (process.env.NODE_ENV !== "test") throw new Error("test-only");
  publicKey = pem ?? FIRMWARE_PUBLIC_KEY_PEM;
};

/** One application slot (firmware/partitions.csv). Nothing bigger can install. */
export const MAX_IMAGE_BYTES = 0x400000;

/** ECDSA P-256 over SHA-256 of the image, DER-encoded: what the firmware checks. */
export const verifyImage = (image: Buffer, signature: Buffer): boolean => {
  try {
    return verify("sha256", image, { key: publicKey, dsaEncoding: "der" }, signature);
  } catch {
    return false;
  }
};

export const sha256Hex = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

export type ImageTag = { version: string; build: string; hw: string; host: string };

const TAG = Buffer.from("SCANCART-IMAGE|", "latin1");

/**
 * Reads the tag every image carries about itself:
 *
 *   SCANCART-IMAGE|fw=1.3.1|build=usb|hw=esp32s3-devkitc1-n16r8|host=https://…|
 *
 * Trusted over anything the uploader says, because it is inside the bytes the
 * signature covers. Null when it is missing, repeated, or malformed.
 */
export const parseImageTag = (image: Buffer): ImageTag | null => {
  const at = image.indexOf(TAG);
  if (at < 0 || image.indexOf(TAG, at + 1) >= 0) return null;
  const end = image.indexOf(0, at);
  if (end < 0 || end - at > 512) return null;
  const text = image.subarray(at + TAG.length, end).toString("latin1");
  if (!text.endsWith("|")) return null;

  const fields = new Map<string, string>();
  for (const part of text.slice(0, -1).split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const tag = { version: fields.get("fw") ?? "", build: fields.get("build") ?? "", hw: fields.get("hw") ?? "", host: fields.get("host") ?? "" };
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag.version)) return null;
  if (!/^[a-z0-9_-]{1,32}$/.test(tag.build)) return null;
  if (tag.hw.length === 0 || tag.hw.length > 64) return null;
  if (!/^https?:\/\/[^/\s|]+$/.test(tag.host)) return null;
  return tag;
};

/** The origin a request was sent to, as the client saw it (Vercel sits in front). */
export const requestOrigin = (request: Request): string => {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`.toLowerCase();
};
