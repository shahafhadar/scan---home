import { z } from "zod";
import { authenticateDevice, json } from "@/server/deviceAuth";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

const count = z.number().int().nonnegative();

// What the firmware reports every minute. Unknown fields are dropped, and a
// malformed beat still counts as the device being alive.
const beat = z
  .object({
    fw: z.string().max(32),
    rssi: z.number().int(),
    scanner_attached: z.boolean(),
    keys_seen: count,
    uptime: count,
    reset_reason: z.string().max(20),
    boot_count: count,
    safe_mode: z.boolean(),
    failed_boots: count.max(255),
    ota_probation: z.boolean(),
    hw: z.string().max(64),
    self_test: z.boolean(),
    free_heap: count,
    min_heap: count,
    queue_size: count,
    queue_failed: count,
    queue_dropped: count,
    errors: count,
    wifi_reconnects: count,
    usb_restarts: count,
    // The outcome of a command the device just ran, reported back to close the
    // loop (pending -> sent -> done/failed).
    command_ack: z
      .object({ id: z.string().uuid(), status: z.enum(["done", "failed"]), result: z.unknown().optional() })
      .optional(),
  })
  .partial();

/** Telemetry in, and at most one command out, so no broker is needed. */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const auth = await authenticateDevice(request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let parsed: z.infer<typeof beat> = {};
  try {
    const result = beat.safeParse(JSON.parse(raw || "{}"));
    if (result.success) parsed = result.data;
  } catch {
    // keep the empty beat
  }

  const row = await one<{ command: unknown }>(`SELECT public.device_heartbeat($1, $2) AS command`, [
    auth.device.id,
    JSON.stringify(parsed),
  ]);
  return json({ ok: true, claimed: auth.device.household_id !== null, command: row?.command ?? null });
}
