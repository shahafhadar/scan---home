import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsError, needsOperator, sendSms, smsConfigured } from "./sms019";

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

  it("ignores spaces and line breaks pasted around the settings", async () => {
    vi.stubEnv("SMS019_USERNAME", " acme\n");
    vi.stubEnv("SMS019_TOKEN", "secret-token \n");
    vi.stubEnv("SMS019_SOURCE", "ScanHome ");
    const fetchMock = reply({ status: 0, shipment_id: "7" });
    await sendSms("+972501234567", "hello", fetchMock);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string).sms).toMatchObject({ user: { username: "acme" }, source: "ScanHome" });
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

describe("sendSms under a time budget", () => {
  it("retries once when 019 says too many requests a second", async () => {
    configure();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 429, message: "slow down" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 0, shipment_id: "9" }), { status: 200 }));
    expect(await sendSms("+972501234567", "hello", fetchMock, { retryAfterMs: 0 })).toBe("9");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after that one retry", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 429 }), { status: 200 }));
    await expect(sendSms("+972501234567", "hello", fetchMock, { retryAfterMs: 0 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry other refusals", async () => {
    configure();
    const fetchMock = reply({ status: 4, message: "no credit" });
    await expect(sendSms("+972501234567", "hello", fetchMock, { retryAfterMs: 0 })).rejects.toMatchObject({ status: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the budget has run out", async () => {
    configure();
    const fetchMock = reply({ status: 429 });
    await expect(sendSms("+972501234567", "hello", fetchMock, { retryAfterMs: 0, budgetMs: 800 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a dropped connection into an SmsError that says nothing was confirmed", async () => {
    configure();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await sendSms("+972501234567", "hello", fetchMock).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsError);
    expect((error as SmsError).message).toContain("did not answer");
    expect(needsOperator(error)).toBe(false);
  });

  it("knows which refusals need the account owner", () => {
    expect(needsOperator(new SmsError("x", 4))).toBe(true);
    expect(needsOperator(new SmsError("x", 515))).toBe(true);
    expect(needsOperator(new SmsError("x", 429))).toBe(false);
    expect(needsOperator(new SmsError("x"))).toBe(false);
    expect(needsOperator(new Error("x"))).toBe(false);
  });
});
