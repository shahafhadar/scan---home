import { describe, expect, it } from "vitest";
import { applyChange, type Item } from "./ShoppingList";
import { isOnline } from "./devices/Devices";

const item = (over: Partial<Item>): Item => ({
  id: "1",
  list_id: "L",
  barcode: "729",
  name: "חלב",
  quantity: 1,
  unit: null,
  status: "pending",
  identified: true,
  note: null,
  updated_at: "2026-11-17T10:00:00Z",
  ...over,
});

describe("live list updates", () => {
  it("replaces a row instead of duplicating it when its quantity changes", () => {
    const next = applyChange([item({})], item({ quantity: 2 }), "L");
    expect(next).toHaveLength(1);
    expect(next[0]!.quantity).toBe(2);
  });

  it("drops a row that was removed or moved to another list", () => {
    expect(applyChange([item({})], item({ status: "removed" }), "L")).toHaveLength(0);
    expect(applyChange([item({})], item({ list_id: "other" }), "L")).toHaveLength(0);
  });
});

describe("device status", () => {
  it("counts a device as online for three minutes after it was last seen", () => {
    const now = Date.parse("2026-11-17T10:00:00Z");
    expect(isOnline("2026-11-17T09:58:00Z", now)).toBe(true);
    expect(isOnline("2026-11-17T09:56:00Z", now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});
