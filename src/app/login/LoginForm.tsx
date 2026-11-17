"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "limited">("idle");

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

  // The sign-in link only works in the browser that asked for it (PKCE).
  // On a phone that means opening it from the mail app in this same browser,
  // not in the mail app's own built-in viewer.
  if (state === "sent")
    return (
      <div className="flex flex-col gap-2">
        <p>שלחנו קישור ל־{email}.</p>
        <p className="text-sm text-muted">
          פתחו אותו באותו דפדפן שבו אתם עכשיו. בטלפון: לחיצה ארוכה על הקישור במייל ← פתיחה ב־Safari או ב־Chrome.
        </p>
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
      <button disabled={state === "sending"} className="rounded-xl bg-accent text-accent-foreground py-3 font-medium disabled:opacity-60">
        {state === "sending" ? "שולח…" : "שלחו לי קישור"}
      </button>
      {state === "error" && <p className="text-danger text-sm">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
      {state === "limited" && (
        <p className="text-danger text-sm">נשלחו יותר מדי קישורים בזמן קצר. נסו שוב בעוד כמה דקות, או השתמשו בקישור שכבר הגיע.</p>
      )}
    </form>
  );
}
