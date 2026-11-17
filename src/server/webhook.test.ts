import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook";

const key = Buffer.from("a-test-signing-key-of-some-length");
const secret = `v1,whsec_${key.toString("base64")}`;
const NOW = 1_800_000_000;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

const good = { secret, id: "msg_1", timestamp: String(NOW), body: '{"a":1}', now: NOW };
const signed = { ...good, signature: sign(good.id, good.timestamp, good.body) };

describe("verifyWebhook", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyWebhook(signed)).toBe(true);
  });

  it("accepts a secret without the v1,whsec_ prefix", () => {
    expect(verifyWebhook({ ...signed, secret: key.toString("base64") })).toBe(true);
  });

  it("accepts when any of several signatures matches", () => {
    expect(verifyWebhook({ ...signed, signature: `v1,AAAA ${signed.signature}` })).toBe(true);
  });

  it("rejects a changed body", () => {
    expect(verifyWebhook({ ...signed, body: '{"a":2}' })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyWebhook({ ...signed, secret: `v1,whsec_${Buffer.from("other-key").toString("base64")}` })).toBe(false);
  });

  it("rejects an old timestamp, so a captured request cannot be replayed later", () => {
    const old = String(NOW - 301);
    expect(verifyWebhook({ ...good, timestamp: old, signature: sign(good.id, old, good.body) })).toBe(false);
  });

  it("rejects missing parts", () => {
    expect(verifyWebhook({ ...signed, signature: null })).toBe(false);
    expect(verifyWebhook({ ...signed, id: null })).toBe(false);
    expect(verifyWebhook({ ...signed, timestamp: null })).toBe(false);
    expect(verifyWebhook({ ...signed, secret: "" })).toBe(false);
  });

  it("rejects an unknown signature version", () => {
    expect(verifyWebhook({ ...signed, signature: signed.signature.replace("v1,", "v2,") })).toBe(false);
  });
});
