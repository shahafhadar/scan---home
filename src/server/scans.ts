import { z } from "zod";
import { one } from "./db";
import type { Device } from "./deviceAuth";
import { lookupOnline } from "./openFoodFacts";

export const scanSchema = z.object({
  // z.guid, not z.uuid: the firmware formats 16 random bytes as a UUID without
  // setting the RFC version bits, and that is fine -- it only has to be unique.
  scan_id: z.guid(),
  barcode: z.string().min(1).max(64).regex(/^[\x20-\x7E]+$/),
  symbology: z.string().max(20).optional(),
  ts: z.number().int().positive().optional(),
  queued: z.boolean().optional(),
  quantity: z.number().positive().max(99).optional(),
});

export type ScanInput = z.infer<typeof scanSchema>;

export type ScanOutcome = {
  scan_id: string;
  status: "added" | "bumped" | "duplicate" | "held";
  name?: string;
  identified?: boolean;
  quantity?: number;
  list_id?: string;
  item_id?: string;
};

// A device clock that has not synced reports 1970. Keep the order of the
// device's own timestamps when they are plausible, otherwise use ours.
const scannedAt = (ts?: number): Date => {
  if (!ts) return new Date();
  const at = new Date(ts * 1000);
  const plausible = at.getUTCFullYear() >= 2024 && at.getTime() <= Date.now() + 5 * 60_000;
  return plausible ? at : new Date();
};

/**
 * Records one scan. Safe to call twice with the same scan_id: the database
 * function inserts the scan row first, in the same transaction as the list
 * change, so even a resend racing the original is caught.
 */
export const ingestScan = async (device: Device, input: ScanInput): Promise<ScanOutcome> => {
  const externalName = device.household_id ? await lookupOnline(input.barcode) : null;
  const row = await one<{ outcome: ScanOutcome }>(
    `SELECT public.device_ingest_scan($1, $2, $3, $4, $5, $6, $7, $8) AS outcome`,
    [
      device.id,
      input.scan_id,
      input.barcode,
      input.symbology ?? null,
      scannedAt(input.ts),
      input.queued ?? false,
      input.quantity ?? 1,
      externalName,
    ],
  );
  return row!.outcome;
};
