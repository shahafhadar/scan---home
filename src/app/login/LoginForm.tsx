"use client";
import { useState } from "react";
import { EmailLogin } from "./EmailLogin";
import { PhoneLogin } from "./PhoneLogin";

// Inlined at build time. Off until the SMS provider and the Supabase hook are
// set up, so the screen never offers a way in that cannot work yet.
const smsLogin = process.env.NEXT_PUBLIC_SMS_LOGIN === "true";

const EMAIL_INTRO = "כניסה עם קישור שנשלח למייל, בלי סיסמה.";
const PHONE_INTRO = "כניסה עם קוד שנשלח אליך ב־SMS, בלי סיסמה.";

export function LoginForm() {
  const [mode, setMode] = useState<"phone" | "email">(smsLogin ? "phone" : "email");
  if (!smsLogin) {
    return (
      <>
        <p className="text-sm text-muted mb-4">{EMAIL_INTRO}</p>
        <EmailLogin />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{mode === "phone" ? PHONE_INTRO : EMAIL_INTRO}</p>
      {mode === "phone" ? <PhoneLogin onUnavailable={() => setMode("email")} /> : <EmailLogin />}
      <button type="button" onClick={() => setMode(mode === "phone" ? "email" : "phone")} className="text-sm text-muted py-1">
        {mode === "phone" ? "כניסה עם מייל במקום" : "כניסה עם מספר טלפון"}
      </button>
    </div>
  );
}
