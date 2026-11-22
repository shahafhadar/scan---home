import { isRecentAuth } from "@/lib/reauth";
import { supabaseServer } from "@/lib/supabase/server";
import { recordSecurityEvent } from "@/server/securityLog";

/**
 * "Close my account": marks the signed-in person's account deleted (a soft
 * delete -- delete_my_account in the database), then signs them out. Because
 * deleting is destructive it needs a recent sign-in, not just a valid session,
 * so a left-open or borrowed session cannot close the account.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await supabaseServer();
  if (!supabase) return Response.json({ error: "not_set_up" }, { status: 503 });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return Response.json({ error: "signed_out" }, { status: 401 });

  if (!isRecentAuth(user.last_sign_in_at)) {
    await recordSecurityEvent("account_delete_refused_reauth", { userId: user.id });
    return Response.json({ error: "reauth_required" }, { status: 401 });
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) return Response.json({ error: "failed" }, { status: 500 });

  await recordSecurityEvent("account_deleted", { userId: user.id });
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
