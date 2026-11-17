import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { Setup } from "./Setup";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="devices">
      <Setup />
    </AppShell>
  );
}
