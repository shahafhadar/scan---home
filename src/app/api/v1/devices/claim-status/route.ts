import { authenticateDevice, json } from "@/server/deviceAuth";

export const dynamic = "force-dynamic";

/** The device polls this until someone pairs it, then lights up green. */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateDevice(request, "");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const claimed = auth.device.household_id !== null;
  return json({
    claimed,
    status: auth.device.status,
    pairing_code: claimed ? undefined : auth.device.pairing_code,
  });
}
