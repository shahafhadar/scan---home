import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { DeviceDetail } from "./DeviceDetail";

export const dynamic = "force-dynamic";

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  const { id } = await params;
  return (
    <AppShell current="devices">
      <DeviceDetail deviceId={id} />
    </AppShell>
  );
}
