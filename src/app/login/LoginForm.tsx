"use client";
import { useEffect, useState } from "react";
import { smsEnabled } from "@/lib/features";
import { EmailLogin } from "./EmailLogin";
import { PhoneLogin } from "./PhoneLogin";

const EMAIL_INTRO = "כניסה עם קישור שנשלח למייל, בלי סיסמה.";
const PHONE_INTRO = "כניסה עם קוד שנשלח אליך ב־SMS, בלי סיסמה.";

const REMEMBER = "scan-home-login-mode";

export function LoginForm() {
  const [mode, setMode] = useState<"phone" | "email">(smsEnabled ? "phone" : "email");

  // Whoever signed in with email last time should not have to switch back.
  useEffect(() => {
    if (!smsEnabled) return;
    try {
      if (localStorage.getItem(REMEMBER) === "email") setMode("email");
    } catch {
      // Storage can be blocked (private windows); the default is fine.
    }
  }, []);
  const choose = (next: "phone" | "email") => {
    setMode(next);
    try {
      localStorage.setItem(REMEMBER, next);
    } catch {
      // Not remembering is harmless.
    }
  };

  if (!smsEnabled) {
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
      {mode === "phone" ? <PhoneLogin /> : <EmailLogin />}
      <button type="button" onClick={() => choose(mode === "phone" ? "email" : "phone")} className="text-sm text-muted py-1">
        {mode === "phone" ? "כניסה עם מייל במקום" : "כניסה עם מספר טלפון"}
      </button>
    </div>
  );
}
