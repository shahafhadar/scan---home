import { authenticateDevice, json } from "@/server/deviceAuth";
import { ingestScan, scanSchema } from "@/server/scans";

export const dynamic = "force-dynamic";

/** One scan, sent the moment it happens. */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const auth = await authenticateDevice(request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const parsed = scanSchema.safeParse(safeJson(raw));
  if (!parsed.success) return json({ error: "invalid scan" }, 400);

  const outcome = await ingestScan(auth.device, parsed.data);
  // 202 tells the firmware "kept, but not on a list yet": it beeps differently
  // so the owner knows to finish pairing.
  return json(outcome, outcome.status === "held" ? 202 : 200);
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
