import { formatPhone, toE164 } from "@/lib/phone";
import { supabaseServer } from "@/lib/supabase/server";
import { formatListSms, type ListLine } from "@/server/listMessage";
import { SmsError, sendSms, smsConfigured } from "@/server/sms019";

/**
 * "Send me the list": texts the signed-in person's open shopping list to their
 * own verified phone number. The number is never taken from the request, only
 * from their account, so this cannot be used to text anyone else, and each
 * person has a small allowance (reserve_sms_send) because every text costs.
 */
export const dynamic = "force-dynamic";

// `code` is what the screen switches on; the wording lives there.
const refuse = (status: number, code: string) => Response.json({ error: code }, { status });

export async function POST() {
  const supabase = await supabaseServer();
  if (!supabase || !smsConfigured()) return refuse(503, "not_set_up");

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return refuse(401, "signed_out");

  // A number the person has not confirmed by code is not theirs to text.
  const to = user.phone_confirmed_at ? toE164(user.phone ?? "") : null;
  if (!to) return refuse(409, "no_phone");

  const { data: lists } = await supabase
    .from("lists")
    .select("id")
    .eq("is_active", true)
    .is("archived_at", null)
    .limit(1);
  const listId = lists?.[0]?.id as string | undefined;
  if (!listId) return refuse(404, "no_list");

  const { data: rows, error } = await supabase
    .from("list_items")
    .select("name, quantity, unit, identified, barcode")
    .eq("list_id", listId)
    .eq("status", "pending")
    .order("updated_at", { ascending: false });
  if (error) return refuse(500, "read_failed");

  const text = formatListSms((rows ?? []) as ListLine[]);
  if (!text) return refuse(400, "empty");

  const { data: allowed, error: limitError } = await supabase.rpc("reserve_sms_send");
  if (limitError) return refuse(500, "read_failed");
  if (!allowed) return refuse(429, "limited");

  try {
    await sendSms(to, text);
  } catch (failure) {
    // The send never happened, so give the allowance back -- a provider
    // failure should not cost the person one of their few texts.
    await supabase.rpc("release_sms_send");
    // The message names 019's status, never the number or the list.
    console.error("list-sms:", failure instanceof SmsError ? failure.message : "unexpected failure");
    return refuse(502, "send_failed");
  }
  return Response.json({ ok: true, to: formatPhone(to) });
}
