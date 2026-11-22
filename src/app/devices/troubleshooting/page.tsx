import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { NotConfigured } from "@/components/NotConfigured";

export const dynamic = "force-dynamic";

const ITEMS: { q: string; a: string }[] = [
  { q: "הנורית מהבהבת כחול", a: "המכשיר במצב הגדרה. מתחברים לרשת ScanCart-XXXX ופותחים את דף ההגדרה שלו (יש כפתור לזה בהגדרת סורק)." },
  { q: "הנורית אדומה", a: "אין WiFi או אין שעון מדויק. בדקו שהראוטר פעיל ושיש אינטרנט ברשת שבחרתם." },
  { q: "הנורית כתומה", a: "המכשיר מחובר אבל לא מגיע לשרת. הסריקות נשמרות אצלו ולא אובדות — הן יישלחו כשהקשר יחזור." },
  { q: "'המכשיר לא רואה את הסורק'", a: "בדקו שהדונגל האלחוטי מחובר ושקיבל חשמל (5V ל-VBUS). סורק שמחובר נכון מדליק נורית משלו." },
  { q: "הרשת שלי לא ברשימה בדף ההגדרה", a: "המכשיר תומך רק ב-2.4GHz. אם הראוטר משדר רק 5GHz, יש לפצל אותו לשתי רשתות או להשתמש ברשת 2.4GHz אם קיימת." },
  { q: "'לא נמצא מכשיר' / הוא לא מופיע באפליקציה", a: "ודאו שהמכשיר חובר לרשת הבית (לא תקוע ברשת ScanCart-XXXX), ושחלפו פחות מ-10 דקות מההתחברות — אחרת צריך לאפס ולחבר מחדש." },
  { q: "המכשיר מתנתק שוב ושוב", a: "ייתכן בעיית חשמל או אות WiFi חלש. קרבו אותו לראוטר ונסו ספק כוח אחר." },
  { q: "פעולה (אתר/הפעלה מחדש) לא קורית", a: "ודאו שהמכשיר מחובר (נקודה ירוקה). הפעולה מגיעה אליו בתוך דקה; אם 'פג תוקף' — נסו שוב כשהוא מחובר." },
];

export default async function TroubleshootingPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="devices">
      <section className="flex flex-col gap-4 md:max-w-lg">
        <h1 className="text-xl font-bold">פתרון תקלות</h1>
        <div className="flex flex-col gap-3">
          {ITEMS.map((item) => (
            <details key={item.q} className="rounded-2xl bg-surface border p-4 shadow-sm">
              <summary className="font-medium cursor-pointer select-none">{item.q}</summary>
              <p className="text-sm text-muted mt-2">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
