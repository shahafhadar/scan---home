import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSms = vi.fn();
vi.mock("@/server/sms019", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sms019")>()),
  sendSms,
}));
const reserveOtpSend = vi.fn();
vi.mock("@/server/otpBudget", () => ({
  reserveOtpSend: (...args: unknown[]) => reserveOtpSend(...args),
  clientIp: () => null,
}));
const { POST } = await import("./route");

const key = Buffer.from("hook-test-signing-key-material");
const SECRET = `v1,whsec_${key.toString("base64")}`;

const call = (payload: unknown, { signed = true }: { signed?: boolean } = {}) => {
  const body = JSON.stringify(payload);
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  return POST(
    new Request("https://app.test/api/auth/send-sms", {
      method: "POST",
      headers: {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": signed ? signature : "v1,AAAA",
      },
      body,
    }),
  );
};

const hook = (phone = "972501234567", otp = "123456") => ({ user: { phone }, sms: { otp } });

beforeEach(() => {
  sendSms.mockReset().mockResolvedValue("1");
  reserveOtpSend.mockReset().mockResolvedValue(true);
  vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
  vi.stubEnv("SMS019_USERNAME", "acme");
  vi.stubEnv("SMS019_TOKEN", "t");
  vi.stubEnv("SMS019_SOURCE", "HomeOne");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("send SMS hook", () => {
  it("sends the code to the person's number", async () => {
    const response = await call(hook());
    expect(response.status).toBe(200);
    expect(sendSms).toHaveBeenCalledWith("+972501234567", expect.stringContaining("123456"));
  });

  it("sends to the number being added when someone verifies a new phone", async () => {
    await call({ user: { phone: "", new_phone: "972541234567" }, sms: { otp: "654321" } });
    expect(sendSms).toHaveBeenCalledWith("+972541234567", expect.stringContaining("654321"));
  });

  it("refuses a request that is not signed by Supabase", async () => {
    const response = await call(hook(), { signed: false });
    expect(response.status).toBe(401);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not send abroad", async () => {
    const response = await call(hook("14155552671"));
    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("says it is not set up rather than pretending", async () => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", "");
    expect((await call(hook())).status).toBe(503);
  });

  it("reports a gateway failure without leaking the number or the code", async () => {
    const { SmsError } = await import("@/server/sms019");
    sendSms.mockRejectedValue(new SmsError("019 refused the message (4): out of credit", 4));
    const response = await call(hook());
    expect(response.status).toBe(502);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("123456");
    expect(text).not.toContain("501234567");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("123456");
  });

  it("rejects a malformed payload", async () => {
    expect((await call({ user: {}, sms: {} })).status).toBe(400);
    expect((await call({ user: { phone: "972501234567" }, sms: { otp: "abc" } })).status).toBe(400);
  });

  it("refuses, without sending, when the number is over its code budget", async () => {
    reserveOtpSend.mockResolvedValueOnce(false);
    const response = await call(hook());
    expect(response.status).toBe(429);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
