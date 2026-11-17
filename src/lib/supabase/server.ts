import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/** A Supabase client for server components and route handlers, as the signed-in person. */
export const supabaseServer = async (): Promise<SupabaseClient | null> => {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
};
