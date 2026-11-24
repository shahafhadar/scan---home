import { authenticateDevice, json } from "@/server/deviceAuth";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

const FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.bin(\.sig)?$/;

/**
 * Serves a release image (`<id>.bin`) or its detached signature
 * (`<id>.bin.sig`) to a device, signed like every device request (HMAC over
 * an empty body).
 *
 * Only a release built for this device's build and board, and not pulled, is
 * served; anything else is 404, so ids are not a way to fish for images. The
 * length is declared, but Vercel streams the body chunked anyway; the firmware
 * counts the bytes against the size in the offer and refuses one past it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const auth = await authenticateDevice(request, "");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const match = FILE.exec((await params).file);
  if (!match) return json({ error: "not found" }, 404);
  const [, id, sig] = match;

  const row = await one<{ data: Buffer }>(
    `SELECT ${sig ? "r.signature" : "r.image"} AS data
       FROM public.firmware_releases r
       JOIN public.devices d ON d.id = $1
      WHERE r.id = $2 AND NOT r.yanked AND r.build = d.firmware_build AND r.hw = d.hw_revision`,
    [auth.device.id, id],
  );
  if (!row) return json({ error: "not found" }, 404);

  return new Response(new Uint8Array(row.data), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(row.data.length),
      "cache-control": "no-store",
    },
  });
}
