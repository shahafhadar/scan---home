import { describe, expect, it } from "vitest";
import { classifySendError, classifyVerifyError, problemText, secondsToWait } from "./authErrors";

describe("classifySendError", () => {
  it.each([
    [{ code: "phone_provider_disabled", status: 422 }, "unavailable"],
    [{ message: "Unsupported phone provider", status: 400 }, "unavailable"],
    [{ code: "phone_exists", status: 422 }, "taken"],
    [{ code: "over_sms_send_rate_limit", status: 429 }, "cooldown"],
    [{ code: "over_request_rate_limit", status: 429 }, "limited"],
    [{ status: 429 }, "limited"],
    [{ name: "AuthRetryableFetchError", status: 0 }, "network"],
    [{ status: 0 }, "network"],
    [{ message: "Failed to fetch" }, "network"],
    [{ code: "unexpected_failure", status: 500 }, "send"],
    [{ code: "sms_send_failed", status: 500 }, "send"],
    [{ code: "hook_timeout", status: 504 }, "send"],
  ] as const)("%j is %s", (error, expected) => {
    expect(classifySendError(error)).toBe(expected);
  });
});

describe("classifyVerifyError", () => {
  it.each([
    [{ code: "otp_expired", status: 403 }, "wrong"],
    [{ status: 400, message: "Token has expired or is invalid" }, "wrong"],
    [{ status: 422, code: "validation_failed" }, "wrong"],
    [{ status: 429, code: "over_request_rate_limit" }, "limited"],
    [{ name: "AuthRetryableFetchError", status: 0 }, "network"],
    [{ status: 502 }, "send"],
  ] as const)("%j is %s", (error, expected) => {
    expect(classifyVerifyError(error)).toBe(expected);
  });
});

describe("secondsToWait", () => {
  it("reads the wait out of Supabase's message", () => {
    expect(secondsToWait({ message: "For security purposes, you can only request this after 42 seconds." })).toBe(42);
    expect(secondsToWait({ message: "after 1 second" })).toBe(1);
  });
  it("says nothing when the message has no number", () => {
    expect(secondsToWait({ message: "rate limited" })).toBeNull();
    expect(secondsToWait({})).toBeNull();
  });
});

describe("problemText", () => {
  it("has a sentence for every problem", () => {
    for (const problem of ["number", "cooldown", "limited", "send", "network", "wrong", "unavailable", "taken"] as const) {
      expect(problemText(problem).length).toBeGreaterThan(10);
    }
  });
  it("tells how long to wait when it knows", () => {
    expect(problemText("cooldown", 30)).toContain("30");
  });
});
