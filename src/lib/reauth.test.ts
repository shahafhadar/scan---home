import { describe, expect, it } from "vitest";
import { REAUTH_MAX_AGE_MS, isRecentAuth } from "./reauth";

const now = Date.parse("2026-11-22T12:00:00Z");

describe("isRecentAuth", () => {
  it("accepts a sign-in inside the window", () => {
    expect(isRecentAuth(new Date(now - REAUTH_MAX_AGE_MS + 1000).toISOString(), now)).toBe(true);
    expect(isRecentAuth(new Date(now).toISOString(), now)).toBe(true);
  });

  it("rejects a sign-in past the window", () => {
    expect(isRecentAuth(new Date(now - REAUTH_MAX_AGE_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("rejects a missing or unreadable timestamp (fail closed)", () => {
    expect(isRecentAuth(null, now)).toBe(false);
    expect(isRecentAuth(undefined, now)).toBe(false);
    expect(isRecentAuth("not a date", now)).toBe(false);
  });
});
