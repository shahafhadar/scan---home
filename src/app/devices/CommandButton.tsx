"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type CommandType = "locate" | "reboot" | "reprovision" | "factory_reset";

/**
 * Known about this command's lifecycle, to tell the person something useful
 * rather than leaving them watching "ממתין…" forever: reboot and factory reset
 * restart the board immediately, before it can ever report back "done" over
 * this same channel, so "sent" is the last word we will hear.
 */
const FIRES_AND_FORGETS: ReadonlySet<CommandType> = new Set(["reboot", "factory_reset"]);

const LABEL: Record<string, string> = {
  pending: "ממתין למכשיר…",
  sent: "נשלח למכשיר…",
  done: "בוצע ✓",
  failed: "נכשל",
  expired: "פג תוקף — נסו שוב",
};

export function CommandButton({
  deviceId,
  type,
  label,
  confirmText,
  danger,
}: {
  deviceId: string;
  type: CommandType;
  label: string;
  /** Shown as a window.confirm before an irreversible action; omit for none. */
  confirmText?: string;
  danger?: boolean;
}) {
  const supabase = supabaseBrowser();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const run = async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setStatus(null);
    const { data, error } = await supabase.rpc("issue_device_command", { p_device_id: deviceId, p_type: type });
    setBusy(false);
    if (error || !data) {
      setStatus("השליחה נכשלה");
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
      if (s) setStatus(FIRES_AND_FORGETS.has(type) && s === "sent" ? "נשלח — המכשיר מתחיל מחדש" : LABEL[s] ?? s);
      const settled = !s || s === "done" || s === "failed" || s === "expired" || (FIRES_AND_FORGETS.has(type) && s === "sent");
      if (settled || ticks > 30) {
        if (poll.current) clearInterval(poll.current);
      }
    }, 4000);
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={run}
        disabled={busy}
        className={`rounded-lg border px-3 py-2 text-sm text-start disabled:opacity-60 ${danger ? "border-danger text-danger" : ""}`}
      >
        {label}
      </button>
      {status && <span className="text-xs text-muted">{status}</span>}
    </div>
  );
}
