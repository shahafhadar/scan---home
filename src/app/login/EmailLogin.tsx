"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Turnstile } from "@/components/Turnstile";
import { turnstileSiteKey } from "@/lib/features";
import { supabaseBrowser, supabaseMailer } from "@/lib/supabase/client";

type State = "idle" | "sending" | "sent" | "error" | "limited" | "captcha";

export function EmailLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [badCode, setBadCode] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const verifying_ = useRef(false);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (turnstileSiteKey && !captcha) {
      setState("captcha");
      return;
    }
    setState("sending");
    const { error } = await supabaseMailer().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, captchaToken: captcha ?? undefined },
    });
    // The token is single-use; mint a fresh one for any resend.
    setCaptcha(null);
    setCaptchaReset((n) => n + 1);
    // 429: the mail provider's hourly cap. Saying so beats "try again",
    // which only spends another attempt against the same cap.
    setState(!error ? "sent" : error.status === 429 ? "limited" : "error");
  };

  // The code in the email signs in right here, in this tab. No redirect, so
  // it does not matter which browser or mail app the email is opened in.
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (verifying_.current) return;
    verifying_.current = true;
    setVerifying(true);
    setBadCode(false);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      // A fresh attempt is allowed, so release the lock.
      verifying_.current = false;
      setVerifying(false);
      setBadCode(true);
      return;
    }
    // Success: the code is spent and we are navigating away. Keep the lock on
    // so a second submit cannot re-verify the consumed code.
    router.replace("/");
    router.refresh();
  };

  if (state === "sent")
    return (
      <div className="flex flex-col gap-3">
        <p>
          שלחנו מייל ל־<span dir="ltr">{email}</span>.
        </p>
        <p className="text-sm text-muted">פותחים את הקישור שבו, בכל דפדפן. הוא בתוקף לשעה ולשימוש אחד.</p>
        <details className="rounded-xl bg-background border px-3 py-2">
          <summary className="text-sm cursor-pointer select-none">יש קוד במייל? אפשר להקליד אותו כאן</summary>
          <form onSubmit={verify} className="flex flex-col gap-3 mt-3">
            <input
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6,8}"
              maxLength={8}
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="border rounded-xl px-3 py-3 bg-surface text-center text-2xl tracking-[0.4em] font-mono focus:outline-2 focus:outline-accent"
            />
            <button
              disabled={verifying || code.length < 6}
              className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60"
            >
              {verifying ? "בודק…" : "כניסה"}
            </button>
            {badCode && <p className="text-danger text-sm">הקוד לא נכון או שפג תוקפו.</p>}
          </form>
        </details>
        <button
          type="button"
          onClick={() => {
            setState("idle");
            setCode("");
            setBadCode(false);
          }}
          className="text-sm text-muted py-1"
        >
          לשלוח שוב או לכתובת אחרת
        </button>
      </div>
    );

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <input
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="border rounded-xl px-3 py-3 bg-background focus:outline-2 focus:outline-accent"
      />
      <Turnstile onToken={setCaptcha} resetKey={captchaReset} />
      <button disabled={state === "sending"} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
        {state === "sending" ? "שולח…" : "שלחו לי קישור כניסה"}
      </button>
      {state === "captcha" && <p className="text-danger text-sm">השלימו את בדיקת האבטחה ולחצו שוב.</p>}
      {state === "error" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
      {state === "limited" && (
        <p className="text-danger text-sm">נשלחו יותר מדי מיילים בזמן קצר. נסו שוב בעוד כמה דקות, או השתמשו בקישור שכבר הגיע.</p>
      )}
    </form>
  );
}
