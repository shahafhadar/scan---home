import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSms = vi.fn();
vi.mock("@/server/sms019", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sms019")>()),
  sendSms,
}));

type FakeUser = { phone?: string; phone_confirmed_at?: string } | null;
let user: FakeUser;
let items: unknown[];
let lists: unknown[];
let allowed: boolean | null;
const reserve = vi.fn();

// Just enough of the Supabase client for this route: a chain that ends in rows.
const table = (rows: () => unknown[]) => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "limit", "order"]) chain[method] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null });
  return chain;
};
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (name: string) => table(() => (name === "lists" ? lists : items)),
    rpc: async (name: string) => {
      reserve(name);
      return allowed === null ? { data: null, error: { message: "boom" } } : { data: allowed, error: null };
    },
  }),
}));
const { POST } = await import("./route");

const call = async () => {
  const response = await POST();
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeEach(() => {
  sendSms.mockReset().mockResolvedValue("1");
  reserve.mockReset();
  vi.stubEnv("SMS019_USERNAME", "acme");
  vi.stubEnv("SMS019_TOKEN", "t");
  vi.stubEnv("SMS019_SOURCE", "HomeOne");
  vi.spyOn(console, "error").mockImplementation(() => {});
  user = { phone: "972501234567", phone_confirmed_at: "2026-11-17T10:00:00Z" };
  lists = [{ id: "l1" }];
  items = [{ name: "חלב", quantity: 2, unit: null, identified: true, barcode: "7290000066318" }];
  allowed = true;
});

describe("POST /api/list/sms", () => {
  it("texts the open list to the person's own confirmed phone", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, to: "050-123-4567" });
    expect(sendSms).toHaveBeenCalledWith("+972501234567", "רשימת הקניות (1):\n• חלב ×2");
  });

  it("does nothing when SMS is not set up", async () => {
    vi.stubEnv("SMS019_TOKEN", "");
    expect((await call()).status).toBe(503);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("turns away someone who is signed out", async () => {
    user = null;
    expect((await call()).status).toBe(401);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("asks for a phone number when there is none", async () => {
    user = { phone: undefined };
    expect(await call()).toEqual({ status: 409, body: { error: "no_phone" } });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not text a number that was never confirmed by code", async () => {
    user = { phone: "972501234567" };
    expect((await call()).body).toEqual({ error: "no_phone" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not text a number that is not an Israeli mobile", async () => {
    user = { phone: "14155550123", phone_confirmed_at: "2026-11-17T10:00:00Z" };
    expect((await call()).body).toEqual({ error: "no_phone" });
  });

  it("has nothing to send for an empty list, and spends no allowance", async () => {
    items = [];
    expect(await call()).toEqual({ status: 400, body: { error: "empty" } });
    expect(reserve).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuses once the allowance is used up", async () => {
    allowed = false;
    expect(await call()).toEqual({ status: 429, body: { error: "limited" } });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("reports a failed send, refunds the allowance, and keeps the number and list out of the log", async () => {
    sendSms.mockRejectedValue(new Error("019 said no"));
    expect(await call()).toEqual({ status: 502, body: { error: "send_failed" } });
    // The reserved send is given back, so a provider failure costs nothing.
    expect(reserve).toHaveBeenCalledWith("release_sms_send");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("972501234567");
    expect(logged).not.toContain("חלב");
  });
});
