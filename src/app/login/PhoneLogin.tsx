"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Turnstile } from "@/components/Turnstile";
import { turnstileSiteKey } from "@/lib/features";
import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseBrowser } from "@/lib/supabase/client";

const RESEND_AFTER_SECONDS = 30;
const CODE_LENGTH = 6;

type Step = "phone" | "code";
type Problem = "number" | "send" | "limited" | "wrong-code" | "unavailable" | "captcha" | null;

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
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const verifying = useRef(false);
  const captchaReady = !turnstileSiteKey || !!captcha;

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const request = async (e164: string) => {
    if (turnstileSiteKey && !captcha) {
      setProblem("captcha");
      return;
    }
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      phone: e164,
      options: { captchaToken: captcha ?? undefined },
    });
    // The token is single-use; mint a fresh one for any resend.
    setCaptcha(null);
    setCaptchaReset((n) => n + 1);
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
    if (error) {
      // A fresh attempt is allowed, so release the lock.
      verifying.current = false;
      setBusy(false);
      setProblem("wrong-code");
      setCode("");
      return;
    }
    // Success: the code is now spent and we are navigating away. Keep the lock
    // on. The screen auto-submits at six digits *and* has a submit button, and
    // mobile SMS autofill can fire a change moments later -- without this, a
    // second verify would hit the already-consumed code and show a false
    // "wrong code" error even though sign-in succeeded.
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
        {problem === "captcha" && <p className="text-danger text-sm">השלימו את בדיקת האבטחה כדי לשלוח קוד חדש.</p>}
        {wait <= 0 && <Turnstile onToken={setCaptcha} resetKey={captchaReset} />}
        <div className="flex justify-between text-sm">
          <button
            type="button"
            onClick={() => void request(phone)}
            disabled={busy || wait > 0 || !captchaReady}
            className="text-accent disabled:text-muted"
          >
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
      <Turnstile onToken={setCaptcha} resetKey={captchaReset} />
      <button disabled={busy} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
        {busy ? "שולח…" : "שלחו לי קוד"}
      </button>
      {problem === "number" && <p className="text-danger text-sm">המספר לא נראה תקין. נייד ישראלי, למשל 050-123-4567.</p>}
      {problem === "captcha" && <p className="text-danger text-sm">השלימו את בדיקת האבטחה ולחצו שוב.</p>}
      {problem === "unavailable" && (
        <p className="rounded-xl bg-background border p-3 text-sm">כניסה עם טלפון עוד לא פעילה במערכת הזאת. אפשר להיכנס עם מייל, בקישור שמתחת.</p>
      )}
      {problem === "send" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
      {problem === "limited" && <p className="text-danger text-sm">נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות.</p>}
    </form>
  );
}
