"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Where the sign-in link lands. The link carries the session in the URL
 * fragment (`#access_token=…&refresh_token=…`), which never reaches the
 * server, so it is read here in the browser, stored as the session, and wiped
 * from the address bar.
 */
export function Confirm() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // strict mode runs effects twice; the fragment is only there once
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!accessToken || !refreshToken) {
      router.replace("/login?error=link");
      return;
    }
    void supabaseBrowser()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          router.replace("/login?error=link");
          return;
        }
        router.replace("/");
        router.refresh();
      });
  }, [router]);

  return <p className="text-muted">נכנסים…</p>;
}
