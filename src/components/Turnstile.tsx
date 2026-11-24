"use client";
import { useEffect, useRef } from "react";
import { turnstileSiteKey } from "@/lib/features";

/**
 * Cloudflare Turnstile bot-check. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is set; otherwise it is nothing, so the login forms work before CAPTCHA is
 * turned on. `onToken` is called with a fresh token (or null when it expires or
 * fails); tokens are single-use, so bump `resetKey` after each use to get a new
 * one for the next request (e.g. a resend).
 */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<void> | null = null;
const loadScript = (): Promise<void> => {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loader;
};

export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Keep the latest callback without re-rendering the widget.
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    if (!turnstileSiteKey || !holder.current) return;
    let cancelled = false;
    void loadScript()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(holder.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          // Widget already gone; nothing to clean up.
        }
      }
      widgetId.current = null;
    };
  }, []);

  // A spent token cannot be reused: reset the widget to mint a fresh one.
  useEffect(() => {
    if (resetKey === 0) return;
    callback.current(null);
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  if (!turnstileSiteKey) return null;
  return <div ref={holder} className="flex justify-center min-h-[65px]" />;
}
