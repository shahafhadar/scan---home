import { NotConfigured } from "@/components/NotConfigured";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/requireUser";
import { ShoppingList } from "./ShoppingList";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <AppShell current="list">
      <ShoppingList />
    </AppShell>
  );
}
