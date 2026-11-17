import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { NotConfigured } from "@/components/NotConfigured";
import { requireUser } from "@/lib/requireUser";

export const dynamic = "force-dynamic";

/**
 * For people who build the scanner themselves. The everyday setup (/setup)
 * speaks plainly and leaves all of this out; the wiring lives here instead.
 */
export default async function BuildPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="devices">
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold">בניית הסורק בעצמכם</h1>
          <p className="text-sm text-muted mt-1">
            העמוד הזה הוא למי שמרכיב את הסורק בעצמו. אם קיבלתם קופסה מוכנה,{" "}
            <Link href="/setup" className="underline">
              הולכים להגדרה הרגילה
            </Link>
            .
          </p>
        </div>

        <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2">
          <h2 className="font-bold text-lg">מה צריך</h2>
          <ul className="list-disc ps-5 flex flex-col gap-1.5">
            <li>
              לוח <span dir="ltr">ESP32-S3-DevKitC-1</span>
            </li>
            <li>
              סורק ברקודים עם דונגל אלחוטי (<span dir="ltr">2.4GHz</span>)
            </li>
            <li>שקע USB-A נקבה מחווט ללוח, או מפצל OTG עם הזנת חשמל</li>
            <li>
              מטען USB רגיל (<span dir="ltr">5V</span>) וכבל USB-C
            </li>
          </ul>
        </div>

        <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2">
          <h2 className="font-bold text-lg">חיווט</h2>
          <p>
            ללוח שני שקעי USB-C. <b dir="ltr">UART</b> הוא לחשמל (ולצריבה מהמחשב). <b dir="ltr">USB</b> שייך לסורק, אבל הוא לא
            מוציא <span dir="ltr">5V</span>, ולכן הדונגל לא עובד אם מחברים אותו אליו ישירות.
          </p>
          <p className="font-medium mt-2">שקע USB-A נקבה ללוח:</p>
          <pre dir="ltr" className="text-xs leading-5 bg-background rounded-lg p-3 overflow-x-auto">
{`USB-A          DevKitC-1
VBUS (red)  →  5V
D-  (white) →  GPIO19
D+  (green) →  GPIO20
GND (black) →  GND

buzzer +    →  GPIO21
buzzer -    →  GND`}
          </pre>
          <p className="text-sm text-muted">
            בלי הלחמה: מפצל OTG עם הזנת חשמל לשקע ה־USB, והדונגל מקבל ממנו <span dir="ltr">5V</span>.
          </p>
        </div>

        <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-2">
          <h2 className="font-bold text-lg">הסורק</h2>
          <ol className="list-decimal ps-5 flex flex-col gap-2">
            <li>
              מגדירים את הסורק למקלדת <b dir="ltr">US</b> (ברקוד הגדרה מהחוברת שלו). בפריסה אחרת הברקודים מגיעים חתוכים.
            </li>
            <li>מכניסים את הדונגל לשקע ה־USB-A.</li>
            <li>מחברים מטען לשקע ה־UART. נורה בלוח נדלקת.</li>
          </ol>
        </div>

        <Link href="/setup" className="block text-center rounded-xl bg-accent text-accent-foreground py-3 font-medium">
          ממשיכים להגדרה
        </Link>
      </section>
    </AppShell>
  );
}
