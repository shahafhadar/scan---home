import { NotConfigured } from "@/components/NotConfigured";
import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/requireUser";
import { Setup } from "./Setup";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <main className="mx-auto max-w-lg px-4 safe-top safe-bottom">
      <Nav current="devices" />
      <Setup />
    </main>
  );
}
