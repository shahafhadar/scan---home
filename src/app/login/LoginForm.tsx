"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type State = "idle" | "sending" | "sent" | "error" | "limited";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [badCode, setBadCode] = useState(false);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    // 429: the mail provider's hourly cap. Saying so beats "try again",
    // which only spends another attempt against the same cap.
    setState(!error ? "sent" : error.status === 429 ? "limited" : "error");
  };

  // The code in the email signs in right here, in this tab. No redirect, so
  // it does not matter which browser or mail app the email is opened in.
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifying(true);
    setBadCode(false);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email, token: code, type: "email" });
    setVerifying(false);
    if (error) {
      setBadCode(true);
      return;
    }
    router.replace("/");
    router.refresh();
  };

  if (state === "sent")
    return (
      <form onSubmit={verify} className="flex flex-col gap-3">
        <p>
          שלחנו מייל ל־<span dir="ltr">{email}</span>.
        </p>
        <p className="text-sm text-muted">מקלידים כאן את הקוד מהמייל, או לוחצים על הקישור שבו.</p>
        <input
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6,8}"
          maxLength={8}
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          className="border rounded-xl px-3 py-3 bg-background text-center text-2xl tracking-[0.4em] font-mono focus:outline-2 focus:outline-accent"
        />
        <button disabled={verifying || code.length < 6} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
          {verifying ? "בודק…" : "כניסה"}
        </button>
        {badCode && <p className="text-danger text-sm">הקוד לא נכון או שפג תוקפו.</p>}
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
      </form>
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
      <button disabled={state === "sending"} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
        {state === "sending" ? "שולח…" : "שלחו לי קוד כניסה"}
      </button>
      {state === "error" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
      {state === "limited" && (
        <p className="text-danger text-sm">נשלחו יותר מדי מיילים בזמן קצר. נסו שוב בעוד כמה דקות, או השתמשו בקוד שכבר הגיע.</p>
      )}
    </form>
  );
}
