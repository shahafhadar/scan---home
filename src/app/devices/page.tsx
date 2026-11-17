import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { Devices } from "./Devices";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="devices">
      <Devices />
    </AppShell>
  );
}
