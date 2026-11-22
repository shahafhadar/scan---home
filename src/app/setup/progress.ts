/** Pure helpers for the setup wizard, kept apart so they can be tested. */

export type DeviceRow = {
  id: string;
  serial: string;
  name: string | null;
  status: string;
  household_id: string | null;
  last_seen_at: string | null;
  scanner_attached: boolean | null;
};

export type ScanRow = { scan_id: string; barcode: string; received_at: string; list_item_id: string | null };

/**
 * The device this setup paired: active, in a household, and heard from since
 * the wizard handed out its code. A factory-reset board keeps its id, so "a
 * new row" would miss it; "heard from since" does not.
 */
export const pairedSince = (devices: DeviceRow[], since: string): DeviceRow | null =>
  devices
    .filter((d) => d.status === "active" && d.household_id !== null && d.last_seen_at !== null && d.last_seen_at >= since)
    .sort((a, b) => (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""))[0] ?? null;

/** The first scan from this device that reached the list after the test began. */
export const firstScanSince = (scans: ScanRow[], since: string): ScanRow | null =>
  scans
    .filter((s) => s.received_at >= since && s.list_item_id !== null)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))[0] ?? null;

export const STEPS = ["חיבור", "סריקת בדיקה"] as const;
export type Step = 0 | 1;
