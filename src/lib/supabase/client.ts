"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
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
