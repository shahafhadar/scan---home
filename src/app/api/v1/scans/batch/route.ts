import { z } from "zod";
import { authenticateDevice, json } from "@/server/deviceAuth";
import { ingestScan, scanSchema, type ScanOutcome } from "@/server/scans";

export const dynamic = "force-dynamic";

/**
 * Queue flush after the network comes back. Each entry is processed on its
 * own: one bad scan from a long-offline device must not cost the other
 * forty-nine. The device deletes from its queue only what `accepted` lists.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const auth = await authenticateDevice(request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid batch" }, 400);
  }
  const parsed = z.object({ scans: z.array(z.unknown()).min(1).max(100) }).safeParse(body);
  if (!parsed.success) return json({ error: "invalid batch" }, 400);

  type Failed = { scan_id: string | null; status: "error"; error: string };
  const results: (ScanOutcome | Failed)[] = [];
  for (const entry of parsed.data.scans) {
    const scan = scanSchema.safeParse(entry);
    if (!scan.success) {
      const id = (entry as { scan_id?: unknown })?.scan_id;
      results.push({ scan_id: typeof id === "string" ? id : null, status: "error", error: "invalid scan" });
      continue;
    }
    try {
      results.push(await ingestScan(auth.device, scan.data));
    } catch (error) {
      console.error("batch scan failed", scan.data.scan_id, error);
      results.push({ scan_id: scan.data.scan_id, status: "error", error: "ingest failed" });
    }
  }

  return json({
    results,
    accepted: results.filter((r) => r.status !== "error").map((r) => r.scan_id),
  });
}
