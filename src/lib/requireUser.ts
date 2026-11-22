import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/** The signed-in person, or a redirect to the sign-in page. Null when Supabase is not configured. */
export const requireUser = async () => {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  // A valid session is not enough: a suspended, disabled or deleted account has
  // no access, whatever code signed it in. RLS allows reading only one's own
  // profile row. A missing row (legacy) or a read error is treated as active,
  // so a glitch cannot lock everyone out; the database still gates the data.
  const { data: profile } = await supabase.from("profiles").select("status").eq("user_id", data.user.id).maybeSingle();
  if (profile && profile.status !== "active") redirect("/no-access");
  return data.user;
};
