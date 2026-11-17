"use client";
import { useEffect, useState } from "react";
import { smsEnabled } from "@/lib/features";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "error"; code: string };

/** What each answer from /api/list/sms means to the person, in everyday words. */
const problems: Record<string, string> = {
  no_phone: "כדי לקבל את הרשימה ב־SMS צריך להוסיף מספר נייד לחשבון.",
  limited: "כבר נשלחו כמה הודעות בשעה האחרונה. אפשר לנסות שוב עוד קצת.",
  empty: "הרשימה ריקה, אין מה לשלוח.",
  signed_out: "צריך להיכנס מחדש כדי לשלוח.",
  not_set_up: "שליחה ב־SMS עוד לא פעילה.",
};
const fallback = "ההודעה לא נשלחה. נסו שוב בעוד רגע.";

/** Texts the open shopping list to the signed-in person's own phone, to take to the shop. */
export function SendListButton() {
  const [state, setState] = useState<State>({ kind: "idle" });

  // The "sent" note goes away on its own.
  useEffect(() => {
    if (state.kind !== "sent") return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 8000);
    return () => clearTimeout(timer);
  }, [state]);

  if (!smsEnabled) return null;

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/list/sms", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { to?: string; error?: string };
      setState(response.ok ? { kind: "sent", to: body.to ?? "" } : { kind: "error", code: body.error ?? "" });
    } catch {
      setState({ kind: "error", code: "" });
    }
  };

  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={send}
        disabled={state.kind === "sending"}
        className="inline-flex items-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-sm font-medium shadow-sm disabled:opacity-60"
      >
        <span aria-hidden="true">💬</span>
        {state.kind === "sending" ? "שולח…" : "שלחו לי את הרשימה ב־SMS"}
      </button>
      <div role="status" aria-live="polite" className="text-sm">
        {state.kind === "sent" && (
          <p className="text-accent">
            נשלח אל <span dir="ltr">{state.to}</span>
          </p>
        )}
        {state.kind === "error" && (
          <p className="text-danger">
            {problems[state.code] ?? fallback}{" "}
            {state.code === "no_phone" && (
              <a href="/account" className="text-accent font-medium">
                להוספת מספר ←
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
