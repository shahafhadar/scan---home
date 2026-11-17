import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { Account } from "./Account";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="account">
      <Account email={user.email ?? null} phone={user.phone ? `+${user.phone.replace(/^\+/, "")}` : null} />
    </AppShell>
  );
}
