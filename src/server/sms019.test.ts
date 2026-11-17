import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsError, sendSms, smsConfigured } from "./sms019";

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

const configure = () => {
  vi.stubEnv("SMS019_USERNAME", "acme");
  vi.stubEnv("SMS019_TOKEN", "secret-token");
  vi.stubEnv("SMS019_SOURCE", "ScanHome");
};

afterEach(() => vi.unstubAllEnvs());

describe("sendSms", () => {
  it("is not configured until all three settings exist", () => {
    expect(smsConfigured()).toBe(false);
    configure();
    expect(smsConfigured()).toBe(true);
    vi.stubEnv("SMS019_SOURCE", "");
    expect(smsConfigured()).toBe(false);
  });

  it("sends the documented request with the number in local form", async () => {
    configure();
    const fetchMock = reply({ status: 0, message: "SMS will be sent", shipment_id: "42" });
    expect(await sendSms("+972501234567", "hello", fetchMock)).toBe("42");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://019sms.co.il/api");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string)).toEqual({
      sms: {
        user: { username: "acme" },
        source: "ScanHome",
        destinations: { phone: { _: "0501234567", $: { id: "" } } },
        message: "hello",
      },
    });
  });

  it("explains a refusal without leaking the number or the text", async () => {
    configure();
    const error = await sendSms("+972501234567", "code 123456", reply({ status: 515, message: "Unverified source" })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SmsError);
    expect((error as SmsError).status).toBe(515);
    expect((error as SmsError).message).toContain("sender name is not verified");
    expect((error as SmsError).message).not.toContain("0501234567");
    expect((error as SmsError).message).not.toContain("123456");
  });

  it("fails when 019 answers with something that is not JSON", async () => {
    configure();
    const html = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(sendSms("+972501234567", "x", html)).rejects.toThrow("HTTP 502");
  });

  it("refuses to run unconfigured", async () => {
    await expect(sendSms("+972501234567", "x", reply({ status: 0 }))).rejects.toThrow("not configured");
  });
});
