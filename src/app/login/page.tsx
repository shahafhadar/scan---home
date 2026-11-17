import { supabaseConfig } from "@/lib/supabase/config";
import { NotConfigured } from "@/components/NotConfigured";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!supabaseConfig()) return <NotConfigured />;
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-6 pt-16">
      <h1 className="text-2xl font-bold mb-1">scan home</h1>
      <p className="opacity-70 mb-6">כניסה עם קישור שנשלח למייל, בלי סיסמה.</p>
      {error && <p className="mb-4 text-red-600">הקישור לא תקין או שפג תוקפו. אפשר לבקש קישור חדש.</p>}
      <LoginForm />
    </main>
  );
}
