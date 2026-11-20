"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Device = {
  id: string;
  serial: string;
  name: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_rssi: number | null;
  scanner_attached: boolean | null;
  keys_seen: number;
  uptime_seconds: number | null;
  free_heap: number | null;
  min_heap: number | null;
  queue_size: number;
  queue_dropped: number;
  error_count: number;
  wifi_reconnects: number;
  usb_restarts: number;
  safe_mode: boolean;
  reset_reason: string | null;
};

const COLUMNS =
  "id, serial, name, status, firmware_version, last_seen_at, last_rssi, scanner_attached, keys_seen, " +
  "uptime_seconds, free_heap, min_heap, queue_size, queue_dropped, error_count, wifi_reconnects, usb_restarts, " +
  "safe_mode, reset_reason";

/** Online means a heartbeat or a scan in the last three minutes (heartbeats come every minute). */
export const isOnline = (lastSeen: string | null, now = Date.now()): boolean =>
  lastSeen !== null && now - new Date(lastSeen).getTime() < 3 * 60_000;

const ago = (iso: string | null): string => {
  if (!iso) return "אף פעם";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  if (minutes < 60 * 24) return `לפני ${Math.round(minutes / 60)} שע׳`;
  return new Date(iso).toLocaleDateString("he-IL");
};

export function Devices() {
  const supabase = supabaseBrowser();
  const [devices, setDevices] = useState<Device[]>([]);
  const [token, setToken] = useState<{ token: string; expires_at: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("devices").select(COLUMNS).order("created_at");
    if (data) setDevices(data as unknown as Device[]);
  }, [supabase]);

  // Telemetry arrives once a minute; polling every 30 seconds is plenty.
  useEffect(() => {
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const newToken = async () => {
    const { data, error } = await supabase.rpc("create_claim_token");
    if (error || !data?.[0]) setMessage("לא הצלחנו ליצור קוד. נסו שוב.");
    else setToken(data[0]);
  };

  const claimByCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const { data, error } = await supabase.rpc("claim_device", { p_code: code });
    if (error) setMessage("השיוך נכשל");
    else if (!data?.ok) setMessage(data?.error ?? "השיוך נכשל");
    else {
      setMessage(data.replayed_scans ? `המכשיר נוסף, ו־${data.replayed_scans} סריקות נכנסו לרשימה` : "המכשיר נוסף");
      setCode("");
      void load();
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold mb-2">הסורקים שלי</h1>
        {devices.length === 0 && (
          <div className="rounded-2xl bg-surface border p-6 text-center shadow-sm">
            <p className="font-medium">עוד לא חיברתם סורק.</p>
            <p className="text-sm text-muted mt-1">זה לוקח כחמש דקות, וההדרכה מלווה אתכם בכל צעד.</p>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {devices.map((d) => {
            const online = isOnline(d.last_seen_at);
            return (
              <li key={d.id} className="rounded-2xl bg-surface border p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className={online ? "text-accent" : "text-danger"} aria-hidden="true">
                    ●
                  </span>
                  <span className="font-medium">{d.name ?? d.serial}</span>
                  <span className={`text-sm ms-auto ${online ? "text-accent" : "text-muted"}`}>
                    {online ? "מחובר" : `לא מחובר, נראה ${ago(d.last_seen_at)}`}
                  </span>
                </div>
                {online && d.scanner_attached === false && (
                  <p className="text-sm text-warn mt-2">הקופסה לא מזהה את הסורק. בדקו שהמקלט הקטן נכנס עד הסוף.</p>
                )}
                {!online && d.last_seen_at && (
                  <p className="text-sm text-muted mt-2">בדקו שהקופסה מחוברת לחשמל ושרשת ה־WiFi בבית עובדת.</p>
                )}
                {d.safe_mode && (
                  <p className="text-sm text-danger mt-2">הקופסה נתקלה בבעיה והופעלה במצב בטוח. נתקו אותה מהחשמל וחברו מחדש.</p>
                )}
                <details className="mt-3 text-sm">
                  <summary className="text-muted cursor-pointer">פרטים טכניים</summary>
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs mt-2 opacity-80">
                    <Stat label="גרסה" value={d.firmware_version} />
                    <Stat label="WiFi" value={d.last_rssi !== null ? `${d.last_rssi} dBm` : null} />
                    <Stat label="סורק" value={d.scanner_attached === null ? null : d.scanner_attached ? "מחובר" : "לא מחובר"} />
                    <Stat label="תווים מהסורק" value={d.keys_seen} />
                    <Stat label="בתור" value={d.queue_size} />
                    <Stat label="זיכרון פנוי" value={d.free_heap !== null ? `${Math.round(d.free_heap / 1024)}KB` : null} />
                    <Stat label="מינימום זיכרון" value={d.min_heap !== null ? `${Math.round(d.min_heap / 1024)}KB` : null} />
                    <Stat label="ניתוקי WiFi" value={d.wifi_reconnects} />
                    <Stat label="אתחולי USB" value={d.usb_restarts} />
                    <Stat label="שגיאות" value={d.error_count} />
                    <Stat label="נזרקו מהתור" value={d.queue_dropped} />
                    <Stat label="אתחול אחרון" value={d.reset_reason} />
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-2xl bg-surface border p-4 shadow-sm">
        <h2 className="font-bold mb-1">{devices.length === 0 ? "חיבור הסורק הראשון" : "להוסיף סורק"}</h2>
        <p className="text-sm text-muted mb-3">ההדרכה מלווה אתכם צעד אחר צעד, בלי מילים מסובכות.</p>
        <Link href="/setup" className="block text-center rounded-xl bg-accent text-accent-foreground py-3 font-medium">
          מתחילים
        </Link>

        <details className="mt-4 text-sm">
          <summary className="text-muted cursor-pointer">אפשרויות נוספות</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <p className="text-muted mb-2">קוד שיוך בלבד, בלי ההדרכה:</p>
              {token ? (
                <div>
                  <div dir="ltr" className="text-3xl font-mono tracking-[0.3em] text-center my-2">
                    {token.token}
                  </div>
                  <p className="text-xs text-muted text-center">
                    בתוקף עד {new Date(token.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}, לשימוש
                    אחד
                  </p>
                </div>
              ) : (
                <button onClick={newToken} className="rounded-lg border px-4 py-2">
                  ליצור קוד שיוך
                </button>
              )}
            </div>
            <form onSubmit={claimByCode} className="flex flex-col gap-2">
              <label className="text-muted" htmlFor="device-code">
                הסורק מציג קוד משלו? מקלידים אותו כאן:
              </label>
              <div className="flex gap-2">
                <input
                  id="device-code"
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABC234"
                  className="flex-1 border rounded-lg px-3 py-1.5 bg-background font-mono"
                />
                <button className="rounded-lg border px-3">שיוך</button>
              </div>
            </form>
            <p className="text-muted">
              בניתם את הסורק בעצמכם?{" "}
              <Link href="/setup/build" className="underline">
                הוראות חיווט
              </Link>
            </p>
          </div>
        </details>
        {message && <p className="mt-3 text-sm">{message}</p>}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd dir="ltr" className="text-end">
        {value ?? "–"}
      </dd>
    </div>
  );
}
