"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { firstScanSince, pairedSince, STEPS, type DeviceRow, type ScanRow, type Step } from "./progress";

type Saved = { step: Step; token: { token: string; expires_at: string } | null; since: string | null; scanSince: string | null };

// The phone leaves this page to join the scanner's own WiFi and comes back
// later, sometimes to a reloaded tab. Where the person was must survive that.
const KEY = "scan-home-setup";
const restore = (): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};
const persist = (saved: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // private mode: the wizard still works, it just forgets on reload
  }
};

export function Setup() {
  const supabase = supabaseBrowser();
  const [state, setState] = useState<Saved>({ step: 0, token: null, since: null, scanSince: null });
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [scan, setScan] = useState<{ barcode: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = restore();
    if (saved) setState(saved);
  }, []);

  const go = useCallback((patch: Partial<Saved>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      persist(next);
      return next;
    });
    window.scrollTo({ top: 0 });
  }, []);

  const newCode = async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_claim_token");
    if (rpcError || !data?.[0]) {
      setError("לא הצלחנו ליצור קוד. נסו שוב.");
      return;
    }
    go({ token: data[0], since: new Date().toISOString() });
  };

  // Step 4: wait for the board to come back paired.
  useEffect(() => {
    if (state.step !== 4 || !state.since) return;
    let stopped = false;
    const poll = async () => {
      const { data } = await supabase
        .from("devices")
        .select("id, serial, name, status, household_id, last_seen_at, scanner_attached");
      const found = pairedSince((data ?? []) as DeviceRow[], state.since!);
      if (!stopped && found) setDevice(found);
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [supabase, state.step, state.since]);

  // Step 5: wait for the first scan to land on the list.
  useEffect(() => {
    if (state.step !== 5 || !state.scanSince) return;
    let stopped = false;
    const poll = async () => {
      const { data } = await supabase
        .from("scans")
        .select("scan_id, barcode, received_at, list_item_id")
        .gte("received_at", state.scanSince!)
        .order("received_at")
        .limit(5);
      const first = firstScanSince((data ?? []) as ScanRow[], state.scanSince!);
      if (!first || stopped) return;
      const { data: item } = await supabase.from("list_items").select("name").eq("id", first.list_item_id!).maybeSingle();
      if (!stopped) setScan({ barcode: first.barcode, name: item?.name ?? first.barcode });
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [supabase, state.step, state.scanSince]);

  const finish = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing to forget
    }
  };

  const expired = state.token !== null && new Date(state.token.expires_at).getTime() < Date.now();

  return (
    <section className="pb-8">
      <h1 className="text-xl font-bold mb-1">הגדרת סורק</h1>
      <ol className="flex gap-1 mb-6" aria-label="שלבים">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === state.step ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${i <= state.step ? "bg-green-700" : "bg-foreground/15"}`}
            title={label}
          />
        ))}
      </ol>
      <p className="text-sm opacity-60 mb-1">
        שלב {state.step + 1} מתוך {STEPS.length}
      </p>

      {state.step === 0 && (
        <Card title="מה צריך">
          <ul className="list-disc ps-5 flex flex-col gap-1.5">
            <li>לוח ESP32-S3-DevKitC-1</li>
            <li>סורק ברקודים עם דונגל אלחוטי (2.4GHz)</li>
            <li>שקע USB-A נקבה מחווט ללוח, או מפצל OTG עם הזנת חשמל</li>
            <li>מטען USB רגיל (5V) וכבל USB-C</li>
            <li>WiFi ביתי ב־2.4GHz והסיסמה שלו</li>
          </ul>
          <Next onClick={() => go({ step: 1 })} />
        </Card>
      )}

      {state.step === 1 && (
        <Card title="חיווט">
          <p>
            ללוח שני שקעי USB-C. <b>UART</b> הוא לחשמל (ולצריבה מהמחשב). <b>USB</b> שייך לסורק, אבל הוא לא מוציא 5V, ולכן
            הדונגל לא עובד אם מחברים אותו אליו ישירות.
          </p>
          <p className="font-medium mt-2">שקע USB-A נקבה ללוח:</p>
          <pre dir="ltr" className="text-xs leading-5 bg-foreground/5 rounded-lg p-3 overflow-x-auto">
{`USB-A          DevKitC-1
VBUS (red)  →  5V
D-  (white) →  GPIO19
D+  (green) →  GPIO20
GND (black) →  GND

buzzer +    →  GPIO21
buzzer -    →  GND`}
          </pre>
          <p className="text-sm opacity-70">בלי הלחמה: מפצל OTG עם הזנת חשמל לשקע ה־USB, והדונגל מקבל ממנו 5V.</p>
          <Next onClick={() => go({ step: 2 })} />
          <Back onClick={() => go({ step: 0 })} />
        </Card>
      )}

      {state.step === 2 && (
        <Card title="הסורק">
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              מגדירים את הסורק למקלדת <b dir="ltr">US</b> (ברקוד הגדרה מהחוברת שלו). בפריסה אחרת הברקודים מגיעים חתוכים.
            </li>
            <li>מכניסים את הדונגל לשקע ה־USB-A.</li>
            <li>מחברים מטען לשקע ה־UART. נורה בלוח נדלקת.</li>
          </ol>
          <Next onClick={() => go({ step: 3 })} />
          <Back onClick={() => go({ step: 1 })} />
        </Card>
      )}

      {state.step === 3 && (
        <Card title="קוד שיוך">
          <p>הקוד מחבר את הסורק לרשימה שלכם. הוא בתוקף ל־20 דקות ולשימוש אחד.</p>
          {state.token && !expired ? (
            <>
              <div dir="ltr" className="text-4xl font-mono tracking-[0.3em] text-center my-4">
                {state.token.token}
              </div>
              <p className="text-sm opacity-60 text-center">
                בתוקף עד{" "}
                {new Date(state.token.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}. כדאי
                לזכור אותו או לצלם מסך.
              </p>
              <Next onClick={() => go({ step: 4 })} />
            </>
          ) : (
            <button onClick={newCode} className="w-full rounded-xl bg-foreground text-background py-3 mt-3 font-medium">
              {expired ? "הקוד פג, ליצור חדש" : "ליצור קוד"}
            </button>
          )}
          <Back onClick={() => go({ step: 2 })} />
        </Card>
      )}

      {state.step === 4 && (
        <Card title="חיבור ל־WiFi">
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              לוח חדש פותח רשת משלו מיד. לוח שכבר הוגדר פעם: מחזיקים את כפתור <b>BOOT</b> עשר שניות עד שהוא מאתחל.
            </li>
            <li>
              בטלפון מתחברים לרשת <b dir="ltr">ScanCart-XXXX</b>. דף ההגדרה נפתח לבד, ואם לא, גולשים ל־
              <span dir="ltr">192.168.4.1</span>.
            </li>
            <li>
              ב&quot;קוד מהאפליקציה&quot; מקלידים{" "}
              <b dir="ltr" className="font-mono">
                {state.token?.token ?? "—"}
              </b>
              , בוחרים את רשת הבית, מקלידים סיסמה ולוחצים &quot;התחבר&quot;.
            </li>
            <li>חוזרים לרשת הבית ולעמוד הזה.</li>
          </ol>
          <div className="rounded-lg bg-foreground/5 p-3 mt-4 text-center" aria-live="polite">
            {device ? (
              <>
                <p className="text-green-700 font-bold text-lg">המכשיר מחובר ✓</p>
                <p className="text-sm opacity-70">{device.name ?? device.serial}</p>
                {device.scanner_attached === false && (
                  <p className="text-sm text-amber-600 mt-1">הלוח לא רואה את הסורק. בדקו את הדונגל ואת ה־5V לשקע.</p>
                )}
              </>
            ) : (
              <p className="opacity-70">מחכים שהסורק יתחבר… (עד דקה אחרי ששלחתם את הטופס)</p>
            )}
          </div>
          {device ? (
            <Next onClick={() => go({ step: 5, scanSince: new Date().toISOString() })} />
          ) : (
            <p className="text-sm opacity-60 mt-3">
              הסורק מציג קוד משלו? אפשר להקליד אותו ב<Link href="/devices" className="underline">עמוד המכשירים</Link>.
            </p>
          )}
          <Back onClick={() => go({ step: 3 })} />
        </Card>
      )}

      {state.step === 5 && (
        <Card title="סריקת בדיקה">
          <p>סורקים מוצר כלשהו מהמטבח.</p>
          <div className="rounded-lg bg-foreground/5 p-4 mt-4 text-center" aria-live="polite">
            {scan ? (
              <>
                <p className="text-green-700 font-bold text-lg">קיבלתי ✓</p>
                <p>{scan.name}</p>
                <p dir="ltr" className="text-xs opacity-60">
                  {scan.barcode}
                </p>
              </>
            ) : (
              <p className="opacity-70">מחכים לסריקה…</p>
            )}
          </div>
          {scan && (
            <Link
              href="/"
              onClick={finish}
              className="block text-center w-full rounded-xl bg-foreground text-background py-3 mt-4 font-medium"
            >
              לרשימה
            </Link>
          )}
          {!scan && (
            <p className="text-sm opacity-60 mt-3">
              לא מגיע? בעמוד המכשירים רואים אם הלוח מחובר ואם הוא רואה את הסורק.
            </p>
          )}
          {error && <p className="text-red-600 mt-2">{error}</p>}
          <Back onClick={() => go({ step: 4 })} />
        </Card>
      )}

      {error && state.step !== 5 && <p className="text-red-600 mt-2">{error}</p>}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-2">
      <h2 className="font-bold text-lg">{title}</h2>
      {children}
    </div>
  );
}

function Next({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full rounded-xl bg-foreground text-background py-3 mt-3 font-medium">
      הבא
    </button>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full py-2 text-sm opacity-70">
      חזרה
    </button>
  );
}
