"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseBrowser } from "@/lib/supabase/client";

const RESEND_AFTER_SECONDS = 30;
const CODE_LENGTH = 6;

type Step = "phone" | "code";
type Problem = "number" | "send" | "limited" | "wrong-code" | "unavailable" | null;

/**
 * Sign in with an Israeli mobile number: type the number, get a text, type the
 * six digits. Supabase makes and checks the code; the text goes out through 019
 * (see /api/auth/send-sms).
 */
export function PhoneLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [wait, setWait] = useState(0);
  const verifying = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const request = async (e164: string) => {
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (!error) {
      setPhone(e164);
      setCode("");
      setStep("code");
      setWait(RESEND_AFTER_SECONDS);
      return;
    }
    // Phone sign-in is not switched on in Supabase (yet). Say so, instead of
    // quietly showing a different form: the person typed a number and expects
    // a code screen.
    if (error.code === "phone_provider_disabled" || /unsupported phone provider/i.test(error.message)) {
      setProblem("unavailable");
      return;
    }
    setProblem(error.status === 429 ? "limited" : "send");
  };

  const submitPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    const e164 = toE164(input);
    if (!e164) {
      setProblem("number");
      return;
    }
    await request(e164);
  };

  const verify = async (token: string) => {
    if (!phone || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ phone, token, type: "sms" });
    verifying.current = false;
    setBusy(false);
    if (error) {
      setProblem("wrong-code");
      setCode("");
      return;
    }
    router.replace("/");
    router.refresh();
  };

  const onCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    // Six digits is the whole code: no button to hunt for with a thumb.
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  if (step === "code" && phone)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === CODE_LENGTH) void verify(code);
        }}
        className="flex flex-col gap-3"
      >
        <p>
          שלחנו הודעה ל־<span dir="ltr">{formatPhone(phone)}</span>.
        </p>
        <p className="text-sm text-muted">מקלידים את 6 הספרות שבהודעה.</p>
        <input
          autoFocus
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={CODE_LENGTH}
          dir="ltr"
          aria-label="קוד מההודעה"
          value={code}
          onChange={(event) => onCode(event.target.value)}
          placeholder="••••••"
          className="border rounded-xl px-3 py-3 bg-background text-center text-3xl tracking-[0.4em] font-mono focus:outline-2 focus:outline-accent"
        />
        <button
          disabled={busy || code.length < CODE_LENGTH}
          className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60"
        >
          {busy ? "בודק…" : "כניסה"}
        </button>
        {problem === "wrong-code" && <p className="text-danger text-sm">הקוד לא נכון או שפג תוקפו. אפשר לנסות שוב או לבקש חדש.</p>}
        {problem === "send" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
        {problem === "limited" && <p className="text-danger text-sm">נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות.</p>}
        <div className="flex justify-between text-sm">
          <button type="button" onClick={() => void request(phone)} disabled={busy || wait > 0} className="text-accent disabled:text-muted">
            {wait > 0 ? `שליחה מחדש בעוד ${wait} שניות` : "לא הגיעה הודעה? שלחו שוב"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setProblem(null);
            }}
            className="text-muted"
          >
            מספר אחר
          </button>
        </div>
      </form>
    );

  return (
    <form onSubmit={submitPhone} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted">מספר הנייד שלך</span>
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
      {problem === "number" && <p className="text-danger text-sm">המספר לא נראה תקין. נייד ישראלי, למשל 050-123-4567.</p>}
      {problem === "unavailable" && (
        <p className="rounded-xl bg-background border p-3 text-sm">כניסה עם טלפון עוד לא פעילה במערכת הזאת. אפשר להיכנס עם מייל, בקישור שמתחת.</p>
      )}
      {problem === "send" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
      {problem === "limited" && <p className="text-danger text-sm">נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות.</p>}
    </form>
  );
}
