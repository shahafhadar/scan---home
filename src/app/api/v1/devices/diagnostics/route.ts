import { authenticateDevice, json } from "@/server/deviceAuth";
import { query } from "@/server/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;

/** A full snapshot, sent only when asked. The last twenty are kept. */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const auth = await authenticateDevice(request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (raw.length > MAX_BYTES) return json({ error: "too large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "expected an object" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ error: "expected an object" }, 400);
  }

  await query(`INSERT INTO public.device_diagnostics (device_id, snapshot) VALUES ($1, $2)`, [
    auth.device.id,
    raw,
  ]);
  await query(
    `DELETE FROM public.device_diagnostics
      WHERE device_id = $1
        AND id NOT IN (SELECT id FROM public.device_diagnostics WHERE device_id = $1 ORDER BY at DESC LIMIT 20)`,
    [auth.device.id],
  );
  return json({ ok: true });
}
