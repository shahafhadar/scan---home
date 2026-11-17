import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/** The signed-in person, or a redirect to the sign-in page. Null when Supabase is not configured. */
export const requireUser = async () => {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
};
