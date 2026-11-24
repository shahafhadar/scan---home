import { describe, expect, it } from "vitest";
import { firstScanSince, pairedSince, type DeviceRow } from "./progress";

const device = (patch: Partial<DeviceRow>): DeviceRow => ({
  id: "d1",
  serial: "SC-1",
  name: null,
  status: "active",
  household_id: "h1",
  last_seen_at: "2026-11-17T10:00:00.000Z",
  scanner_attached: true,
  ...patch,
});

describe("pairedSince", () => {
  const since = "2026-11-17T10:00:00.000Z";

  it("finds a device paired after the code was handed out", () => {
    expect(pairedSince([device({ last_seen_at: "2026-11-17T10:01:00.000Z" })], since)?.id).toBe("d1");
  });

  it("ignores devices only heard from before, unpaired ones and disabled ones", () => {
    expect(
      pairedSince(
        [
          device({ id: "old", last_seen_at: "2026-11-17T09:59:00.000Z" }),
          device({ id: "unclaimed", status: "unclaimed", household_id: null, last_seen_at: "2026-11-17T10:02:00.000Z" }),
          device({ id: "disabled", status: "disabled", last_seen_at: "2026-11-17T10:02:00.000Z" }),
          device({ id: "silent", last_seen_at: null }),
        ],
        since,
      ),
    ).toBeNull();
  });

  it("picks the most recently heard from when several qualify", () => {
    expect(
      pairedSince(
        [device({ id: "a", last_seen_at: "2026-11-17T10:01:00.000Z" }), device({ id: "b", last_seen_at: "2026-11-17T10:03:00.000Z" })],
        since,
      )?.id,
    ).toBe("b");
  });
});

describe("firstScanSince", () => {
  it("returns the earliest scan that reached the list after the test began", () => {
    const scans = [
      { scan_id: "before", barcode: "1", received_at: "2026-11-17T09:00:00.000Z", list_item_id: "i0" },
      { scan_id: "held", barcode: "2", received_at: "2026-11-17T10:00:01.000Z", list_item_id: null },
      { scan_id: "second", barcode: "3", received_at: "2026-11-17T10:00:05.000Z", list_item_id: "i2" },
      { scan_id: "first", barcode: "4", received_at: "2026-11-17T10:00:02.000Z", list_item_id: "i1" },
    ];
    expect(firstScanSince(scans, "2026-11-17T10:00:00.000Z")?.scan_id).toBe("first");
  });
});
