"use client";
import { useEffect, useRef } from "react";
import { codeDigits } from "@/lib/phone";

export const CODE_LENGTH = 6;

/**
 * The box for the six digits of a texted code. It takes the code however it
 * arrives: typed, pasted with spaces or Arabic digits, filled in by the
 * keyboard's one-time-code suggestion (iOS and Android), or read straight from
 * the incoming text by Chrome on Android (WebOTP, which needs the text to end
 * with `@<site> #<code>`; see src/server/otpMessage.ts).
 *
 * `onChange` gets the digits so far. `onComplete` fires once, when there are six.
 */
export function OtpField({
  value,
  onChange,
  onComplete,
  disabled,
  focusKey,
}: {
  value: string;
  onChange: (digits: string) => void;
  onComplete: (digits: string) => void;
  disabled?: boolean;
  /** Changing this puts the cursor back in the box, e.g. after a wrong code cleared it. */
  focusKey?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(onComplete);
  const change = useRef(onChange);
  useEffect(() => {
    done.current = onComplete;
    change.current = onChange;
  });

  useEffect(() => {
    input.current?.focus();
  }, [focusKey]);

  // Chrome on Android can hand over the code from the incoming text by itself.
  useEffect(() => {
    if (typeof window === "undefined" || !("OTPCredential" in window) || !navigator.credentials) return;
    const abort = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: abort.signal } as CredentialRequestOptions)
      .then((credential) => {
        const digits = codeDigits((credential as { code?: string } | null)?.code ?? "", CODE_LENGTH);
        if (digits.length === CODE_LENGTH) {
          change.current(digits);
          done.current(digits);
        }
      })
      .catch(() => {
        // Refused, timed out or aborted: typing the code still works.
      });
    return () => abort.abort();
  }, []);

  const handle = (raw: string) => {
    const digits = codeDigits(raw, CODE_LENGTH);
    onChange(digits);
    // Six digits is the whole code: no button to hunt for with a thumb.
    if (digits.length === CODE_LENGTH) onComplete(digits);
  };

  return (
    <input
      ref={input}
      required
      disabled={disabled}
      // `text`, not `number`: no spinner buttons, and a code may start with 0.
      type="text"
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="[0-9]*"
      // No maxLength on purpose: a code pasted as "123 456" is seven characters
      // and would lose its last digit. The handler keeps the first six digits.
      dir="ltr"
      aria-label="קוד מההודעה"
      value={value}
      onChange={(event) => handle(event.target.value)}
      placeholder="••••••"
      className="border rounded-xl px-3 py-3 bg-background text-center text-3xl tracking-[0.4em] font-mono focus:outline-2 focus:outline-accent disabled:opacity-60"
    />
  );
}
