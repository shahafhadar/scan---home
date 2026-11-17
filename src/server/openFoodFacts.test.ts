import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ one: vi.fn(async () => undefined) }));
const { lookupOnline } = await import("./openFoodFacts");
const { one } = await import("./db");

const respond = (product: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ product }), { status: 200 }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(one).mockResolvedValue(undefined);
});

describe("lookupOnline", () => {
  it("stays off unless switched on", async () => {
    const fetchMock = respond({ product_name: "Milk" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupOnline("7290000066318")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers the Hebrew name and adds the brand", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS", "true");
    const fetchMock = respond({ product_name: "Milk 3%", product_name_he: "חלב 3%", brands: "תנובה, Tnuva" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupOnline("7290000066318")).toBe("חלב 3% תנובה");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("user-agent")).toMatch(/^ScanHome\//);
  });

  it("does not ask when the barcode is already known", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS", "true");
    vi.mocked(one).mockResolvedValue({ "?column?": 1 });
    const fetchMock = respond({ product_name: "Milk" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupOnline("7290000066318")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fails the scan when the service does", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS", "true");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await lookupOnline("7290000066318")).toBeNull();
  });
});
