"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CommandButton } from "@/app/devices/CommandButton";
import { supabaseBrowser } from "@/lib/supabase/client";

type Device = {
  id: string;
  serial: string;
  name: string | null;
  household_id: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_rssi: number | null;
  scanner_attached: boolean | null;
  safe_mode: boolean;
  ota_state: string | null;
  ota_target_version: string | null;
  ota_rejected_version: string | null;
};

const COLUMNS =
  "id, serial, name, household_id, status, firmware_version, last_seen_at, last_rssi, scanner_attached, safe_mode, " +
  "ota_state, ota_target_version, ota_rejected_version";

/** 1.10.0 > 1.9.0: compared as numbers, never as text. */
const versionCode = (v: string | null): number | null => {
  const m = v ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v) : null;
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : null;
};

/**
 * Where automatic updating stands, in a sentence (docs/firmware-ota.md).
 * Null for firmware too old to report it.
 */
export const updateStatus = (d: Pick<Device, "firmware_version" | "ota_state" | "ota_target_version" | "ota_rejected_version">): string | null => {
  if (!d.ota_state) return null;
  const target = d.ota_target_version;
  const rejected = versionCode(d.ota_rejected_version);
  const current = versionCode(d.firmware_version);
  switch (d.ota_state) {
    case "pending":
      return target ? `גרסה ${target} תותקן ברגע שקט` : "ממתין לעדכון";
    case "downloading":
      return target ? `מתעדכנת ל-${target}…` : "מתעדכנת…";
    case "probation":
      return "בבדיקה אחרי עדכון";
    case "failed":
      return target ? `העדכון ל-${target} לא הצליח, ינסה שוב` : "העדכון לא הצליח, ינסה שוב";
  }
  if (rejected !== null && current !== null && rejected > current) {
    return `העדכון ל-${d.ota_rejected_version} נכשל, חזרה ל-${d.firmware_version}`;
  }
  return "מעודכנת";
};

const isOnline = (lastSeen: string | null): boolean => lastSeen !== null && Date.now() - new Date(lastSeen).getTime() < 3 * 60_000;

const ago = (iso: string | null): string => {
  if (!iso) return "אף פעם";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  if (minutes < 60 * 24) return `לפני ${Math.round(minutes / 60)} שע׳`;
  return new Date(iso).toLocaleDateString("he-IL");
};

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("devices").select(COLUMNS).eq("id", deviceId).maybeSingle();
    if (!data) {
      setNotFound(true);
      return;
    }
    const d = data as unknown as Device;
    setDevice(d);
    setName((current) => current || d.name || "");
    if (d.household_id) {
      const { data: r } = await supabase.rpc("my_role_in", { p_household_id: d.household_id });
      setRole((r as string | null) ?? null);
    }
  }, [supabase, deviceId]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (notFound) return <p className="text-muted">המכשיר לא נמצא, או שאינו שלכם.</p>;
  if (!device) return <p className="text-muted">טוען…</p>;

  const online = isOnline(device.last_seen_at);
  const canAct = role === "owner" || role === "member";
  const isOwner = role === "owner";

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase.from("devices").update({ name: trimmed }).eq("id", deviceId);
    if (error) setProblem("השינוי נכשל");
    else setSavedName(trimmed);
  };

  const release = async () => {
    if (!window.confirm("המכשיר יוסר מהחשבון וייחשב 'לא משויך'. כדי להשתמש בו שוב יהיה צריך לאפס אותו ולהוסיף מחדש. להמשיך?")) return;
    const { error } = await supabase.rpc("release_device", { p_device_id: deviceId });
    if (error) {
      setProblem("ההסרה נכשלה");
      return;
    }
    router.replace("/devices");
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-5 md:max-w-lg">
      <div className="flex items-center gap-2">
        <span className={online ? "text-accent" : "text-danger"}>●</span>
        <h1 className="text-xl font-bold">{device.name ?? device.serial}</h1>
      </div>

      <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2 text-sm">
        <Row label="מספר סידורי" value={device.serial} ltr />
        <Row label="סטטוס" value={online ? "מחובר" : "לא מחובר"} />
        <Row label="נראה" value={ago(device.last_seen_at)} />
        <Row label="גרסת קושחה" value={device.firmware_version} ltr />
        {updateStatus(device) && <Row label="עדכונים" value={updateStatus(device)} />}
        <Row label="עוצמת WiFi" value={device.last_rssi !== null ? `${device.last_rssi} dBm` : null} ltr />
        <Row label="סורק" value={device.scanner_attached === null ? null : device.scanner_attached ? "מחובר" : "לא מחובר"} />
        {device.safe_mode && <p className="text-danger">המכשיר במצב בטוח אחרי אתחולים כושלים.</p>}
      </div>

      {canAct && (
        <form onSubmit={rename} className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2">
          <label className="text-sm text-muted">שם המכשיר</label>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 bg-background" />
            <button className="rounded-lg bg-accent text-accent-foreground px-4 font-medium">שמירה</button>
          </div>
          {savedName && <p className="text-accent text-sm">נשמר ✓</p>}
        </form>
      )}

      {canAct && (
        <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-3">
          <h2 className="font-bold">פעולות</h2>
          <CommandButton deviceId={deviceId} type="locate" label="אתר מכשיר (צליל + נורית)" />
          <CommandButton
            deviceId={deviceId}
            type="reboot"
            label="הפעלה מחדש"
            confirmText="המכשיר יתחבר מחדש ולא יסרוק לכמה שניות. להמשיך?"
          />
          <CommandButton
            deviceId={deviceId}
            type="reprovision"
            label="החלפת רשת WiFi"
            confirmText="המכשיר יתנתק מהרשת הנוכחית ויפתח שוב את רשת ההגדרה שלו (ScanCart-XXXX). להמשיך?"
          />
          {isOwner && (
            <CommandButton
              deviceId={deviceId}
              type="factory_reset"
              label="איפוס לברירת מחדל"
              confirmText="כל ההגדרות, סיסמת ה-WiFi והשיוך לחשבון יימחקו מהמכשיר. פעולה זו אינה הפיכה. להמשיך?"
              danger
            />
          )}
        </div>
      )}

      {isOwner && (
        <button onClick={release} className="rounded-xl border border-danger text-danger py-3 font-medium">
          הסרת המכשיר מהחשבון
        </button>
      )}

      <Link href="/devices/troubleshooting" className="text-sm text-center text-muted underline">
        המכשיר לא מתנהג כצפוי? מדריך פתרון תקלות
      </Link>
      {problem && <p className="text-danger text-sm">{problem}</p>}
    </section>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span dir={ltr ? "ltr" : undefined}>{value ?? "–"}</span>
    </div>
  );
}
