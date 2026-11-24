"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdoptPanel } from "@/app/devices/AdoptPanel";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STEPS, type ScanRow, type Step, firstScanSince } from "./progress";

type Saved = { step: Step; scanSince: string | null };

// The phone may leave this page to join the scanner's WiFi and come back to a
// reloaded tab, so where the person was must survive that.
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
  const [state, setState] = useState<Saved>({ step: 0, scanSince: null });
  const [scan, setScan] = useState<{ barcode: string; name: string } | null>(null);

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

  // Test scan: wait for the first scan to land on the list.
  useEffect(() => {
    if (state.step !== 1 || !state.scanSince) return;
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

  return (
    <section className="pb-8">
      <h1 className="text-xl font-bold mb-1">הגדרת סורק</h1>
      <ol className="flex gap-1 mb-4" aria-label="שלבים">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === state.step ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${i <= state.step ? "bg-accent" : "bg-border"}`}
            title={label}
          />
        ))}
      </ol>
      <p className="text-sm text-muted mb-4">
        שלב {state.step + 1} מתוך {STEPS.length}
      </p>

      {state.step === 0 && (
        <Card title="חיבור לאינטרנט">
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              מחברים את הלוח לחשמל. הוא פותח רשת WiFi בשם <b dir="ltr">ScanCart-XXXX</b>.
              <br />
              <span className="text-sm text-muted">לוח שכבר הוגדר פעם: מחזיקים את כפתור <b>BOOT</b> עשר שניות כדי לאפס.</span>
            </li>
            <li>
              בטלפון מתחברים לרשת <b dir="ltr">ScanCart-XXXX</b>, ואז פותחים את דף ההגדרה בכפתור שמתחת.
            </li>
            <li>בוחרים את רשת הבית, מקלידים סיסמה ולוחצים &quot;התחבר&quot;. חוזרים לרשת הבית ולעמוד הזה.</li>
          </ol>

          <a href="http://192.168.4.1" className="block text-center rounded-xl border py-3 mt-3 font-medium">
            פתח את דף ההגדרה של הסורק
          </a>
          <p className="text-xs text-muted mt-1">
            עובד רק כשאתם מחוברים לרשת <span dir="ltr">ScanCart-XXXX</span>. אם הדף לא נפתח מעצמו — זה הכפתור.
          </p>

          <div className="mt-4">
            <p className="text-sm text-muted mb-2">כשהלוח מתחבר הוא מופיע כאן — טאפ אחד והוא שלכם:</p>
            <AdoptPanel onAdopted={() => go({ step: 1, scanSince: new Date().toISOString() })} />
          </div>

          <details className="mt-5 text-sm">
            <summary className="text-muted cursor-pointer select-none">צריך לחבר קודם את החומרה?</summary>
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <p className="font-medium">מה צריך</p>
                <ul className="list-disc ps-5 text-muted">
                  <li>לוח ESP32-S3-DevKitC-1, סורק ברקודים עם דונגל אלחוטי (2.4GHz)</li>
                  <li>שקע USB-A נקבה מחווט ללוח (או מפצל OTG עם הזנת חשמל), מטען USB-C</li>
                  <li>WiFi ביתי ב־2.4GHz והסיסמה שלו</li>
                </ul>
              </div>
              <div>
                <p className="font-medium">חיווט</p>
                <pre dir="ltr" className="text-xs leading-5 bg-background rounded-lg p-3 overflow-x-auto">
{`USB-A          DevKitC-1
VBUS (red)  →  5V
D-  (white) →  GPIO19
D+  (green) →  GPIO20
GND (black) →  GND
buzzer +    →  GPIO21   buzzer - → GND`}
                </pre>
                <p className="text-muted mt-1">
                  ה-UART לחשמל ולצריבה; ה-USB שייך לסורק ולא מוציא 5V — הדונגל צריך הזנה נפרדת. מגדירים את הסורק למקלדת{" "}
                  <b dir="ltr">US</b>.
                </p>
              </div>
            </div>
          </details>
        </Card>
      )}

      {state.step === 1 && (
        <Card title="סריקת בדיקה">
          <p>סורקים מוצר כלשהו מהמטבח.</p>
          <div className="rounded-lg bg-background p-4 mt-4 text-center" aria-live="polite">
            {scan ? (
              <>
                <p className="text-accent font-bold text-lg">קיבלתי ✓</p>
                <p>{scan.name}</p>
                <p dir="ltr" className="text-xs text-muted">
                  {scan.barcode}
                </p>
              </>
            ) : (
              <p className="text-muted">מחכים לסריקה…</p>
            )}
          </div>
          {scan ? (
            <Link
              href="/"
              onClick={finish}
              className="block text-center w-full rounded-xl bg-accent text-accent-foreground py-3 mt-4 font-medium"
            >
              לרשימה
            </Link>
          ) : (
            <p className="text-sm text-muted mt-3">
              לא מגיע? ב<Link href="/devices" className="underline">עמוד המכשירים</Link> רואים אם הלוח מחובר ואם הוא רואה את הסורק.
            </p>
          )}
          <button onClick={() => go({ step: 0 })} className="w-full py-2 text-sm text-muted mt-1">
            חזרה
          </button>
        </Card>
      )}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2">
      <h2 className="font-bold text-lg">{title}</h2>
      {children}
    </div>
  );
}
