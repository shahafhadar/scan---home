import { NotConfigured } from "@/components/NotConfigured";
import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/requireUser";
import { Account } from "./Account";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <main className="mx-auto max-w-lg px-4 safe-top safe-bottom">
      <Nav current="account" />
      <Account email={user.email ?? null} phone={user.phone ? `+${user.phone.replace(/^\+/, "")}` : null} />
    </main>
  );
}
