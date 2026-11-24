import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { supabaseServer } from "@/lib/supabase/server";
import { Household } from "./Household";

export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  const user = await requireUser();
  const supabase = await supabaseServer();
  if (!user || !supabase) return <NotConfigured />;
  const { data } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return (
    <AppShell current="account">
      <Household householdId={data?.household_id ?? null} myRole={data?.role ?? null} myUserId={user.id} />
    </AppShell>
  );
}
