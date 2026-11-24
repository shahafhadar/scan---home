"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { smsEnabled } from "@/lib/features";
import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseBrowser } from "@/lib/supabase/client";

export function Account({ email, phone, recentAuth }: { email: string | null; phone: string | null; recentAuth: boolean }) {
  const router = useRouter();

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-4 md:max-w-lg">
      <h1 className="text-xl font-bold">החשבון שלי</h1>

      <div className="rounded-2xl bg-surface border p-4 shadow-sm flex flex-col gap-3">
        {email && (
          <div>
            <p className="text-sm text-muted">מייל</p>
            <p dir="ltr" className="text-end">
              {email}
            </p>
          </div>
        )}
        {smsEnabled && <PhoneSection initial={phone} />}
      </div>

      <Link href="/household" className="rounded-xl border py-3 font-medium text-center">
        בני הבית והרשאות
      </Link>

      <a
        href="/api/account/export"
        className="rounded-xl border py-3 font-medium text-center"
        download="scan-home-export.json"
      >
        הורדת הנתונים שלי
      </a>

      <button onClick={signOut} className="rounded-xl border py-3 font-medium">
        יציאה
      </button>

      <DeleteAccount recentAuth={recentAuth} onDeleted={signOut} />
    </section>
  );
}

/**
 * Closing the account. Deliberately a little awkward: the person confirms by
 * typing a word, and the server also insists on a recent sign-in, so neither a
 * stray click nor a left-open session can do it.
 */
function DeleteAccount({ recentAuth, onDeleted }: { recentAuth: boolean; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    const response = await fetch("/api/account/delete", { method: "POST" });
    setBusy(false);
    if (response.ok) {
      onDeleted();
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setProblem(
      body.error === "reauth_required"
        ? "מטעמי אבטחה צריך כניסה עדכנית. התנתקו, היכנסו שוב, ואז אפשר למחוק."
        : "המחיקה נכשלה. נסו שוב בעוד רגע.",
    );
  };

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-danger py-1 self-start">
        מחיקת החשבון
      </button>
    );

  return (
    <div className="rounded-2xl border border-danger/40 p-4 flex flex-col gap-3">
      <p className="font-medium text-danger">מחיקת החשבון</p>
      <p className="text-sm text-muted">
        הרשימות, המכשירים וההעדפות שלכם יינעלו ולא תהיה אליהם גישה. לאישור, הקלידו <b>מחיקה</b>.
      </p>
      {!recentAuth && (
        <p className="text-sm text-muted">שימו לב: ייתכן שתתבקשו להיכנס מחדש לפני המחיקה, מטעמי אבטחה.</p>
      )}
      <input
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        aria-label="הקלדת האישור"
        className="border rounded-xl px-3 py-3 bg-background focus:outline-2 focus:outline-danger"
      />
      <div className="flex gap-3">
        <button
          onClick={remove}
          disabled={busy || confirm.trim() !== "מחיקה"}
          className="rounded-xl bg-danger text-white py-3 px-4 font-medium disabled:opacity-50"
        >
          {busy ? "מוחק…" : "מחיקה לצמיתות"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setConfirm("");
            setProblem(null);
          }}
          className="rounded-xl border py-3 px-4"
        >
          ביטול
        </button>
      </div>
      {problem && <p className="text-danger text-sm">{problem}</p>}
    </div>
  );
}

/**
 * Adds a mobile number to the account, so the same person can sign in with the
 * number (and get the shopping list by SMS) without starting a second account.
 */
function PhoneSection({ initial }: { initial: string | null }) {
  const [phone, setPhone] = useState(initial);
  const [step, setStep] = useState<"show" | "number" | "code">("show");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const e164 = toE164(input);
    if (!e164) {
      setProblem("המספר לא נראה תקין. נייד ישראלי, למשל 050-123-4567.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.updateUser({ phone: e164 });
    setBusy(false);
    if (error) {
      setProblem(error.status === 429 ? "נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות." : "השליחה נכשלה. נסו שוב בעוד רגע.");
      return;
    }
    setPending(e164);
    setCode("");
    setStep("code");
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ phone: pending, token: code, type: "phone_change" });
    setBusy(false);
    if (error) {
      setProblem("הקוד לא נכון או שפג תוקפו.");
      return;
    }
    setPhone(pending);
    setStep("show");
  };

  if (step === "number")
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">מספר הנייד</span>
          <input
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            dir="ltr"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="050-123-4567"
            className="border rounded-xl px-3 py-3 bg-background text-lg focus:outline-2 focus:outline-accent"
          />
        </label>
        <button disabled={busy} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
          {busy ? "שולח…" : "שלחו לי קוד"}
        </button>
        <button type="button" onClick={() => setStep("show")} className="text-sm text-muted">
          ביטול
        </button>
        {problem && <p className="text-danger text-sm">{problem}</p>}
      </form>
    );

  if (step === "code" && pending)
    return (
      <form onSubmit={confirm} className="flex flex-col gap-3">
        <p className="text-sm">
          שלחנו הודעה ל־<span dir="ltr">{formatPhone(pending)}</span>. מקלידים את 6 הספרות:
        </p>
        <input
          autoFocus
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          aria-label="קוד מההודעה"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className="border rounded-xl px-3 py-3 bg-background text-center text-3xl tracking-[0.4em] font-mono focus:outline-2 focus:outline-accent"
        />
        <button disabled={busy || code.length < 6} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
          {busy ? "בודק…" : "לאשר"}
        </button>
        <button type="button" onClick={() => setStep("number")} className="text-sm text-muted">
          מספר אחר
        </button>
        {problem && <p className="text-danger text-sm">{problem}</p>}
      </form>
    );

  return (
    <div>
      <p className="text-sm text-muted">טלפון</p>
      {phone ? (
        <div className="flex items-center justify-between gap-3">
          <p dir="ltr">{formatPhone(phone)}</p>
          <button onClick={() => setStep("number")} className="text-sm text-accent">
            החלפה
          </button>
        </div>
      ) : (
        <button onClick={() => setStep("number")} className="text-accent font-medium">
          + הוספת מספר נייד
        </button>
      )}
      <p className="text-xs text-muted mt-1">עם מספר מאומת אפשר להיכנס בקוד SMS ולקבל את הרשימה להודעה.</p>
    </div>
  );
}
