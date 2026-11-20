"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OtpField, CODE_LENGTH } from "@/components/OtpField";
import { classifySendError, classifyVerifyError, problemText, secondsToWait, type OtpProblem } from "@/lib/authErrors";
import { smsEnabled } from "@/lib/features";
import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";

export function Account({ email, phone }: { email: string | null; phone: string | null }) {
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

      <button onClick={signOut} className="rounded-xl border py-3 font-medium">
        יציאה
      </button>
    </section>
  );
}

/**
 * Adds (or replaces) the mobile number on the account, so the same person can
 * sign in with the number (and get the shopping list by SMS) without starting a
 * second account. Supabase texts a code to the new number and the account only
 * changes once it is typed back.
 */
function PhoneSection({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState(initial);
  const [step, setStep] = useState<"show" | "number" | "code">("show");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<OtpProblem | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const { left: wait, start: startWait } = useCountdown();

  const sendTo = async (e164: string) => {
    if (busy) return;
    if (e164 === phone) {
      setProblem(null);
      setSeconds(null);
      setStep("show");
      return;
    }
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.updateUser({ phone: e164 });
    setBusy(false);
    if (error) {
      setSeconds(secondsToWait(error));
      setProblem(classifySendError(error));
      return;
    }
    setPending(e164);
    setCode("");
    setStep("code");
    startWait(60);
  };

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const e164 = toE164(input);
    if (!e164) {
      setProblem("number");
      return;
    }
    await sendTo(e164);
  };

  const confirm = async (token: string) => {
    if (!pending || busy) return;
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ phone: pending, token, type: "phone_change" });
    setBusy(false);
    if (error) {
      const kind = classifyVerifyError(error);
      // Only a wrong code is cleared; a dropped connection says nothing about it.
      if (kind === "wrong") {
        setCode("");
        setFocusKey((key) => key + 1);
      }
      setProblem(kind);
      return;
    }
    setPhone(pending);
    setStep("show");
    router.refresh();
  };

  const message = problem && (
    <p role="alert" className="text-danger text-sm">
      {problemText(problem, seconds)}
    </p>
  );

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
            onChange={(event) => {
              setInput(event.target.value);
              if (problem === "number") setProblem(null);
            }}
            placeholder="050-123-4567"
            className="border rounded-xl px-3 py-3 bg-background text-lg focus:outline-2 focus:outline-accent"
          />
        </label>
        <button disabled={busy} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
          {busy ? "שולח…" : "שלחו לי קוד"}
        </button>
        <button
          type="button"
          onClick={() => {
            setProblem(null);
            setStep("show");
          }}
          className="text-sm text-muted"
        >
          ביטול
        </button>
        <div aria-live="polite">{message}</div>
      </form>
    );

  if (step === "code" && pending)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === CODE_LENGTH) void confirm(code);
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-sm">
          שלחנו הודעה ל־<span dir="ltr">{formatPhone(pending)}</span>. מקלידים את 6 הספרות:
        </p>
        <OtpField value={code} onChange={setCode} onComplete={(digits) => void confirm(digits)} focusKey={focusKey} />
        <button disabled={busy || code.length < CODE_LENGTH} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
          {busy ? "בודק…" : "לאשר"}
        </button>
        <div aria-live="polite">{message}</div>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={() => void sendTo(pending)} disabled={busy || wait > 0} className="text-accent disabled:text-muted">
            {wait > 0 ? `שליחה מחדש בעוד ${wait} שניות` : "לא הגיעה הודעה? שלחו שוב"}
          </button>
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              setStep("number");
            }}
            className="text-muted"
          >
            מספר אחר
          </button>
        </div>
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
