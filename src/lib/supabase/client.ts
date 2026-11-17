"use client";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

let client: SupabaseClient | undefined;

/** The browser's Supabase client, signed in as the person using the app. */
export const supabaseBrowser = (): SupabaseClient => {
  if (client) return client;
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured");
  client = createBrowserClient(config.url, config.anonKey);
  return client;
};

/**
 * A client used only to ask for the sign-in email, with the implicit flow.
 *
 * The link in that email then carries the session itself, so it works in any
 * browser that opens it. The normal client uses PKCE, which only works in the
 * browser that asked for the link, and on a phone the mail app opens links in
 * its own browser, so the sign-in failed there. It keeps no session of its own.
 */
export const supabaseMailer = (): SupabaseClient => {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured");
  return createClient(config.url, config.anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sb-mailer" },
  });
};
