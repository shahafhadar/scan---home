import { NotConfigured } from "@/components/NotConfigured";
import { requireUser } from "@/lib/requireUser";
import { Join } from "./Join";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  // Must be signed in to accept; requireUser sends a signed-out visitor to login.
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  const { token } = await params;
  return (
    <main className="mx-auto max-w-sm px-5 pt-[max(6rem,env(safe-area-inset-top))] text-center">
      <Join token={token} />
    </main>
  );
}
