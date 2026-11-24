import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks a request signed the Standard Webhooks way, which is how Supabase
 * signs its auth hooks. Without this anyone who finds the URL could make us
 * send SMS at our own expense.
 *
 * Signed content is `<webhook-id>.<webhook-timestamp>.<raw body>`, HMAC-SHA256
 * with the base64 part of the secret. The signature header may hold several
 * space-separated `v1,<base64>` entries (key rotation); any match is enough.
 */
export const verifyWebhook = (input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean => {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  const sent = Number(timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(sent) || Math.abs(now - sent) > (input.toleranceSeconds ?? 300)) return false;

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
};
