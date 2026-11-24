import { supabaseServer } from "@/lib/supabase/server";
import { recordSecurityEvent } from "@/server/securityLog";

/**
 * "Download my data": the signed-in person's own data as JSON. Every read goes
 * through their Supabase client, so row-level security limits it to their own
 * household -- one person can never export another's. Device rows are selected
 * column by column, deliberately leaving out secret_hash and pairing_code.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await supabaseServer();
  if (!supabase) return Response.json({ error: "not_set_up" }, { status: 503 });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return Response.json({ error: "signed_out" }, { status: 401 });

  const [households, members, lists, items, devices, productNames] = await Promise.all([
    supabase.from("households").select("*"),
    supabase.from("household_members").select("*"),
    supabase.from("lists").select("*"),
    supabase.from("list_items").select("*"),
    // Never the device secret or pairing code.
    supabase.from("devices").select("id, serial, name, status, firmware_version, last_seen_at, created_at"),
    supabase.from("household_products").select("*"),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null, phone: user.phone ?? null, created_at: user.created_at },
    households: households.data ?? [],
    household_members: members.data ?? [],
    lists: lists.data ?? [],
    list_items: items.data ?? [],
    devices: devices.data ?? [],
    household_products: productNames.data ?? [],
  };

  await recordSecurityEvent("account_exported", { userId: user.id });

  return Response.json(payload, {
    headers: {
      "content-disposition": 'attachment; filename="scan-home-export.json"',
      "cache-control": "no-store",
    },
  });
}
