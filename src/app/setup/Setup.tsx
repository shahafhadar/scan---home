"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { firstScanSince, migrateStep, pairedSince, STEPS, type DeviceRow, type ScanRow, type Step } from "./progress";

type Saved = {
  v: 2;
  step: Step;
  token: { token: string; expires_at: string } | null;
  since: string | null;
  scanSince: string | null;
};

// The phone leaves this page to join the scanner's own WiFi and comes back
// later, sometimes to a reloaded tab. Where the person was must survive that.
const KEY = "scan-home-setup";
const restore = (): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved>;
    return { v: 2, step: migrateStep(saved), token: saved.token ?? null, since: saved.since ?? null, scanSince: saved.scanSince ?? null };
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
  const [state, setState] = useState<Saved>({ v: 2, step: 0, token: null, since: null, scanSince: null });
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

  // Step 3: wait for the scanner to come back connected.
  useEffect(() => {
    if (state.step !== 3 || !state.since) return;
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

  // Step 4: wait for the first scan to land on the list.
  useEffect(() => {
    if (state.step !== 4 || !state.scanSince) return;
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
      <h1 className="text-xl font-bold mb-1">מחברים את הסורק</h1>
      <ol className="flex gap-1 mb-6" aria-label="שלבים">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === state.step ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${i <= state.step ? "bg-accent" : "bg-border"}`}
            title={label}
          />
        ))}
      </ol>
      <p className="text-sm text-muted mb-2">
        שלב {state.step + 1} מתוך {STEPS.length}
      </p>

      {state.step === 0 && (
        <Card title="בואו נחבר את הסורק">
          <p>זה לוקח בערך חמש דקות, ועושים את זה פעם אחת בלבד.</p>
          <p className="font-medium mt-2">מה נעשה:</p>
          <ol className="list-decimal ps-5 flex flex-col gap-1">
            <li>נחבר את הסורק לחשמל.</li>
            <li>נחבר אותו לאינטרנט של הבית.</li>
            <li>נסרוק מוצר, ונראה אותו ברשימה.</li>
          </ol>
          <p className="font-medium mt-2">מה כדאי שיהיה בהישג יד:</p>
          <ul className="list-disc ps-5 flex flex-col gap-1">
            <li>הסורק והקופסה שלו</li>
            <li>מטען רגיל של טלפון עם כבל USB־C</li>
            <li>הטלפון הזה</li>
            <li>הסיסמה של ה־WiFi בבית</li>
          </ul>
          <p className="text-sm text-muted mt-2">
            הסורק מתחבר לרשת הביתית הרגילה (2.4GHz). אם הנתב שלכם מציע כמה רשתות, בוחרים את הרגילה.
          </p>
          <Next onClick={() => go({ step: 1 })} label="מתחילים" />
          <p className="text-center text-sm text-muted mt-1">
            בניתם את הסורק בעצמכם?{" "}
            <Link href="/setup/build" className="underline">
              הוראות חיווט
            </Link>
          </p>
        </Card>
      )}

      {state.step === 1 && (
        <Card title="מחברים לחשמל">
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>מכניסים את המקלט הקטן של הסורק לשקע ה־USB שבקופסה.</li>
            <li>
              מחברים את המטען לשקע ה־USB־C שכתוב לידו <b dir="ltr">UART</b>. זה השקע של החשמל.
            </li>
            <li>אחרי כמה שניות נדלקת נורה קטנה בקופסה. זה סימן שיש חשמל.</li>
          </ol>
          <Next onClick={() => go({ step: 2 })} label="הנורה דולקת" />
          <Back onClick={() => go({ step: 0 })} />
        </Card>
      )}

      {state.step === 2 && (
        <Card title="הקוד האישי שלכם">
          <p>הקוד הזה מחבר את הסורק לרשימה שלכם, ורק לשלכם. נקליד אותו בעוד רגע.</p>
          {state.token && !expired ? (
            <>
              <div dir="ltr" className="text-4xl font-mono tracking-[0.3em] text-center my-4">
                {state.token.token}
              </div>
              <p className="text-sm text-muted text-center">
                הקוד תקף עד{" "}
                {new Date(state.token.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}. אפשר
                לצלם מסך כדי לא לשכוח אותו.
              </p>
              <Next onClick={() => go({ step: 3 })} />
            </>
          ) : (
            <button onClick={newCode} className="w-full rounded-xl bg-accent text-accent-foreground py-3 mt-3 font-medium">
              {expired ? "הקוד פג, ליצור חדש" : "ליצור את הקוד"}
            </button>
          )}
          <Back onClick={() => go({ step: 1 })} />
        </Card>
      )}

      {state.step === 3 && (
        <Card title="מחברים לאינטרנט של הבית">
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              בטלפון נכנסים להגדרות ה־WiFi ובוחרים ברשת <b dir="ltr">ScanCart-XXXX</b>. הסורק יוצר אותה בעצמו.
            </li>
            <li>דף יפתח לבד. אם הוא לא נפתח, פותחים את הדפדפן וגולשים לכתובת הזאת:</li>
          </ol>
          <p dir="ltr" className="font-mono text-center bg-background rounded-lg py-1.5">
            192.168.4.1
          </p>
          <ol start={3} className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              בדף מקלידים את הקוד האישי:{" "}
              <b dir="ltr" className="font-mono">
                {state.token?.token ?? "—"}
              </b>
            </li>
            <li>בוחרים את הרשת של הבית, מקלידים את הסיסמה שלה ולוחצים &quot;התחבר&quot;.</li>
            <li>חוזרים לרשת הרגילה של הבית (שוב בהגדרות ה־WiFi של הטלפון), ומחכים כאן.</li>
          </ol>
          <div className="rounded-lg bg-background p-3 mt-3 text-center" aria-live="polite">
            {device ? (
              <>
                <p className="text-accent font-bold text-lg">הסורק מחובר ✓</p>
                <p className="text-sm text-muted">{device.name ?? device.serial}</p>
                {device.scanner_attached === false && (
                  <p className="text-sm text-warn mt-1">הקופסה לא מזהה את הסורק. בדקו שהמקלט הקטן נכנס עד הסוף לשקע.</p>
                )}
              </>
            ) : (
              <p className="text-muted">מחכים שהסורק יתחבר… זה לוקח עד דקה אחרי ששלחתם את הטופס.</p>
            )}
          </div>
          {device && <Next onClick={() => go({ step: 4, scanSince: new Date().toISOString() })} />}
          <details className="text-sm mt-3">
            <summary className="text-muted cursor-pointer">הסורק כבר הוגדר פעם, והרשת ScanCart לא מופיעה?</summary>
            <p className="mt-2">
              מחזיקים את הכפתור <b>BOOT</b> שבקופסה 10 שניות, עד שהיא מתאפסת. אחרי כמה שניות הרשת מופיעה, וממשיכים מהסעיף הראשון.
            </p>
          </details>
          <details className="text-sm mt-2">
            <summary className="text-muted cursor-pointer">הסורק מציג קוד משלו?</summary>
            <p className="mt-2">
              אפשר להקליד אותו ב<Link href="/devices" className="underline">עמוד הסורקים</Link>.
            </p>
          </details>
          <Back onClick={() => go({ step: 2 })} />
        </Card>
      )}

      {state.step === 4 && (
        <Card title="סריקה ראשונה">
          <p>סורקים מוצר כלשהו מהמטבח, ומחכים רגע.</p>
          <div className="rounded-lg bg-background p-4 mt-3 text-center" aria-live="polite">
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
          {scan && (
            <Link
              href="/"
              onClick={finish}
              className="block text-center w-full rounded-xl bg-accent text-accent-foreground py-3 mt-4 font-medium"
            >
              לרשימה שלי
            </Link>
          )}
          {!scan && (
            <details className="text-sm mt-3">
              <summary className="text-muted cursor-pointer">לא קורה כלום?</summary>
              <ul className="list-disc ps-5 mt-2 flex flex-col gap-1.5">
                <li>בודקים שהנורה בקופסה עדיין דולקת.</li>
                <li>
                  אם מופיעים תווים חתוכים או מוזרים, הסורק צריך להיות מוגדר למקלדת אנגלית (US). הברקוד להגדרה נמצא בחוברת של
                  הסורק.
                </li>
                <li>
                  ב<Link href="/devices" className="underline">עמוד הסורקים</Link> רואים אם הקופסה מחוברת ואם היא מזהה את הסורק.
                </li>
              </ul>
            </details>
          )}
          {error && <p className="text-danger mt-2">{error}</p>}
          <Back onClick={() => go({ step: 3 })} />
        </Card>
      )}

      {error && state.step !== 4 && <p className="text-danger mt-2">{error}</p>}
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

function Next({ onClick, label = "הבא" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="w-full rounded-xl bg-accent text-accent-foreground py-3 mt-3 font-medium">
      {label}
    </button>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full py-2 text-sm text-muted">
      חזרה
    </button>
  );
}
