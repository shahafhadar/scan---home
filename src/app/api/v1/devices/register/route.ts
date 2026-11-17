import { z } from "zod";
import { json } from "@/server/deviceAuth";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

const registration = z.object({
  serial: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
  secret_hash: z.string().length(64).regex(/^[0-9a-f]+$/),
  firmware_version: z.string().max(32).optional(),
  // The device invents its own code so it can show it on its setup page
  // before it has ever reached us. Used only as the fallback way to pair.
  pairing_code: z.string().length(6).regex(/^[A-Z2-9]+$/).optional(),
  // Typed by the person into the device's setup page, straight from the app.
  // When present the device is claimed on the spot.
  claim_token: z.string().min(4).max(12).optional(),
});

/**
 * The one unsigned call: the server holds no key for this device yet. An
 * unclaimed device can do nothing until a signed-in person pairs it.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid registration" }, 400);
  }
  const parsed = registration.safeParse(body);
  if (!parsed.success) return json({ error: "invalid registration" }, 400);

  const { serial, secret_hash, firmware_version, pairing_code, claim_token } = parsed.data;
  const row = await one<{ result: { pairing_code: string; status: string; claimed: boolean; created: boolean } }>(
    `SELECT public.device_register($1, $2, $3, $4, $5) AS result`,
    [serial, secret_hash, firmware_version ?? null, pairing_code ?? null, claim_token ?? null],
  );
  const { created, ...result } = row!.result;
  return json(result, created ? 201 : 200);
}
