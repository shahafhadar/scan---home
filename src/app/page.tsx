import { NotConfigured } from "@/components/NotConfigured";
import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/requireUser";
import { ShoppingList } from "./ShoppingList";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  if (!user) return <NotConfigured />;
  return (
    <main className="mx-auto max-w-lg px-4 safe-top safe-bottom">
      <Nav current="list" />
      <ShoppingList />
    </main>
  );
}
