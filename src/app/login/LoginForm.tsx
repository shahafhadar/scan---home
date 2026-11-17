"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  };

  if (state === "sent") return <p>שלחנו קישור ל־{email}. פתחו אותו מהטלפון או מהמחשב הזה.</p>;

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <input
        type="email"
        required
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="border rounded-lg px-3 py-2 bg-transparent"
      />
      <button disabled={state === "sending"} className="rounded-lg bg-foreground text-background py-2 font-medium">
        {state === "sending" ? "שולח…" : "שלחו לי קישור"}
      </button>
      {state === "error" && <p className="text-red-600">השליחה נכשלה. נסו שוב בעוד רגע.</p>}
    </form>
  );
}
