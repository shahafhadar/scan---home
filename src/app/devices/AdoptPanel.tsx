"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Candidate = { serial: string; last4: string; firmware_version: string | null; last_seen_at: string | null };

/**
 * Find-and-adopt: polls for scanners that have just come online unclaimed and
 * lets the person add one with a single tap. The device shows up here once it
 * has joined the home WiFi through its setup page -- no code to type.
 */
export function AdoptPanel({ onAdopted }: { onAdopted?: (serial: string) => void }) {
  const supabase = supabaseBrowser();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("list_adoptable_devices");
    setCandidates((data ?? []) as Candidate[]);
  }, [supabase]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const adopt = async (serial: string) => {
    setBusy(serial);
    setProblem(null);
    const { data, error } = await supabase.rpc("adopt_device", { p_serial: serial });
    setBusy(null);
    if (error || !data?.ok) {
      setProblem(data?.error ?? "השיוך נכשל. נסו שוב.");
      return;
    }
    onAdopted?.(serial);
    void load();
  };

  if (candidates.length === 0) {
    return (
      <div aria-live="polite" className="rounded-xl bg-background border p-3 text-sm text-muted">
        מחפש סורק חדש… ודאו שהלוח מחובר לרשת הבית (דרך עמוד ההגדרה שלו).
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <li key={c.serial} className="flex items-center justify-between gap-3 rounded-xl bg-background border p-3">
            <span className="font-medium">
              סורק חדש <span dir="ltr" className="font-mono">••••{c.last4}</span>
            </span>
            <button
              onClick={() => void adopt(c.serial)}
              disabled={busy !== null}
              className="rounded-lg bg-accent text-accent-foreground px-4 py-1.5 font-medium disabled:opacity-60"
            >
              {busy === c.serial ? "משייך…" : "זה שלי"}
            </button>
          </li>
        ))}
      </ul>
      {problem && <p className="text-danger text-sm mt-2">{problem}</p>}
    </div>
  );
}
