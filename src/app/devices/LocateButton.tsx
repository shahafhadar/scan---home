"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const LABEL: Record<string, string> = {
  pending: "ממתין…",
  sent: "נשלח למכשיר…",
  done: "בוצע ✓",
  failed: "נכשל",
  expired: "פג תוקף — נסו שוב",
};

/**
 * Asks the device to beep and flash so it can be found. Issues a tracked
 * command and follows it to a confirmed outcome (the device picks it up on its
 * next heartbeat, within a minute, and reports back on the one after).
 */
export function LocateButton({ deviceId }: { deviceId: string }) {
  const supabase = supabaseBrowser();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const locate = async () => {
    setBusy(true);
    setStatus(null);
    const { data, error } = await supabase.rpc("issue_device_command", { p_device_id: deviceId, p_type: "locate" });
    setBusy(false);
    if (error || !data) {
      setStatus("שליחה נכשלה");
      return;
    }
    const id = data as string;
    setStatus(LABEL.pending);
    if (poll.current) clearInterval(poll.current);
    let ticks = 0;
    poll.current = setInterval(async () => {
      ticks += 1;
      const { data: row } = await supabase.from("device_commands").select("status").eq("id", id).maybeSingle();
      const s = (row as { status?: string } | null)?.status;
      if (s) setStatus(LABEL[s] ?? s);
      if (!s || s === "done" || s === "failed" || s === "expired" || ticks > 30) {
        if (poll.current) clearInterval(poll.current);
      }
    }, 4000);
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <button onClick={locate} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60">
        אתר מכשיר (צליל + נורית)
      </button>
      {status && <span className="text-xs text-muted">{status}</span>}
    </div>
  );
}
