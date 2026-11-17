"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CODE_LENGTH, OtpField } from "@/components/OtpField";
import { classifySendError, classifyVerifyError, problemText, secondsToWait, type OtpProblem } from "@/lib/authErrors";
import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";

/** Supabase lets one number ask for a new code once a minute. */
const RESEND_AFTER_SECONDS = 60;
/** After this many wrong codes the box waits for a fresh code. The server's own limits are what really stop guessing. */
const MAX_WRONG = 5;

/**
 * Where we were when the person left to read the text. On a phone the browser
 * often drops the page while the messages app is in front; without this they
 * come back to an empty number box and a code that no longer fits anywhere.
 */
const PENDING = "scan-home-otp-pending";
const PENDING_FOR_MS = 10 * 60_000;

const readPending = (): { phone: string; at: number } | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING) ?? "null");
    if (saved && typeof saved.phone === "string" && typeof saved.at === "number" && Date.now() - saved.at < PENDING_FOR_MS) return saved;
    localStorage.removeItem(PENDING);
  } catch {
    // Storage blocked or damaged: start over from the number, which always works.
  }
  return null;
};
const writePending = (phone: string, at: number) => {
  try {
    localStorage.setItem(PENDING, JSON.stringify({ phone, at }));
  } catch {
    // Not remembering is harmless.
  }
};
const clearPending = () => {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    // Nothing to clear.
  }
};

type Step = "phone" | "code";

/**
 * Sign in with an Israeli mobile number: type the number, get a text, type the
 * six digits. Supabase makes and checks the code; the text goes out through 019
 * (see /api/auth/send-sms).
 */
export function PhoneLogin({ onUseEmail }: { onUseEmail?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<OtpProblem | null>(null);
  const [wrong, setWrong] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const { left: wait, start: startWait } = useCountdown();
  const verifying = useRef(false);

  // Back from the messages app (or a reload): pick up at the code box.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    setPhone(pending.phone);
    setStep("code");
    startWait(RESEND_AFTER_SECONDS - (Date.now() - pending.at) / 1000);
  }, [startWait]);

  const toCodeStep = (e164: string, seconds: number) => {
    setPhone(e164);
    setCode("");
    setWrong(0);
    setStep("code");
    startWait(seconds);
    writePending(e164, Date.now() - (RESEND_AFTER_SECONDS - seconds) * 1000);
  };

  const request = async (e164: string) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (!error) {
      toCodeStep(e164, RESEND_AFTER_SECONDS);
      return;
    }
    const kind = classifySendError(error);
    if (kind === "cooldown") {
      // A code went out a minute ago and still works: go and type it, rather than telling them to wait.
      toCodeStep(e164, secondsToWait(error) ?? RESEND_AFTER_SECONDS);
    }
    setProblem(kind);
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
    if (!phone || verifying.current || wrong >= MAX_WRONG) return;
    verifying.current = true;
    setBusy(true);
    setProblem(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ phone, token, type: "sms" });
    verifying.current = false;
    setBusy(false);
    if (error) {
      const kind = classifyVerifyError(error);
      // A wrong code is cleared so the next try starts clean. A dropped
      // connection or a busy server says nothing about the code: keep it.
      if (kind === "wrong") {
        setWrong((tries) => tries + 1);
        setCode("");
        setFocusKey((key) => key + 1);
      }
      setProblem(kind);
      return;
    }
    clearPending();
    router.replace("/");
    router.refresh();
  };

  const changeNumber = () => {
    clearPending();
    setStep("phone");
    setProblem(null);
    setCode("");
  };

  const emailInstead = onUseEmail && (
    <button type="button" onClick={onUseEmail} className="text-accent text-sm text-start underline">
      להיכנס עם מייל במקום
    </button>
  );
  const offerEmail = problem === "send" || problem === "unavailable" || problem === "limited";

  if (step === "code" && phone) {
    const locked = wrong >= MAX_WRONG;
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
        <p className="text-sm text-muted">מקלידים את 6 הספרות שבהודעה. היא מגיעה בדרך כלל תוך כמה שניות.</p>
        <OtpField value={code} onChange={setCode} onComplete={(digits) => void verify(digits)} focusKey={focusKey} />
        <button
          disabled={busy || code.length < CODE_LENGTH || locked}
          className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60"
        >
          {busy ? "בודק…" : "כניסה"}
        </button>
        <div aria-live="polite" className="flex flex-col gap-2">
          {problem && !(problem === "cooldown" && wait <= 0) && (
            <p role="alert" className="text-danger text-sm">
              {problemText(problem, wait)}
            </p>
          )}
          {locked && <p className="text-danger text-sm">טעיתם כמה פעמים. מבקשים קוד חדש ומנסים שוב.</p>}
          {/* A minute with no text (a phone that cannot get SMS, no signal, a late gateway) is when email is the way in. */}
          {(offerEmail || wait <= 0) && emailInstead}
        </div>
        <div className="flex justify-between text-sm">
          <button
            type="button"
            onClick={() => void request(phone)}
            disabled={busy || wait > 0}
            className={`disabled:text-muted ${locked || problem === "wrong" ? "text-accent font-medium" : "text-accent"}`}
          >
            {wait > 0 ? `שליחה מחדש בעוד ${wait} שניות` : "לא הגיעה הודעה? שלחו שוב"}
          </button>
          <button type="button" onClick={changeNumber} className="text-muted">
            מספר אחר
          </button>
        </div>
      </form>
    );
  }

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
      <div aria-live="polite" className="flex flex-col gap-2">
        {problem === "unavailable" ? (
          <p role="alert" className="rounded-xl bg-background border p-3 text-sm">
            כניסה עם טלפון עוד לא פעילה במערכת הזאת. אפשר להיכנס עם מייל, בקישור שמתחת.
          </p>
        ) : (
          problem && (
            <p role="alert" className="text-danger text-sm">
              {problemText(problem)}
            </p>
          )
        )}
        {offerEmail && problem !== "unavailable" && emailInstead}
      </div>
      {onUseEmail && !problem && (
        <p className="text-xs text-muted">
          נרשמתם עד היום עם מייל? היכנסו עם המייל. בחשבון אפשר להוסיף את המספר, וכך נשאר חשבון אחד.
        </p>
      )}
    </form>
  );
}
