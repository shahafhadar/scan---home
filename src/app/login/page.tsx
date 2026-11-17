import { supabaseConfig } from "@/lib/supabase/config";
import { Logo } from "@/components/Logo";
import { NotConfigured } from "@/components/NotConfigured";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!supabaseConfig()) return <NotConfigured />;
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-5 safe-top safe-bottom pt-16">
      <div className="flex flex-col items-center text-center mb-8">
        <Logo size={64} />
        <h1 className="text-2xl font-bold mt-4">scan home</h1>
        <p className="text-muted mt-1">סורקים בבית, והרשימה מתמלאת לבד.</p>
      </div>
      <div className="rounded-2xl bg-surface border p-5 shadow-sm">
        {error && <p className="mb-4 text-danger text-sm">הקישור לא תקין או שפג תוקפו. אפשר לבקש קישור חדש.</p>}
        <LoginForm />
      </div>
    </main>
  );
}
