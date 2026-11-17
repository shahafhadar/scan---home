export function NotConfigured() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold mb-2">scan home</h1>
      <p>
        השרת עדיין לא מחובר ל־Supabase. צריך להגדיר את NEXT_PUBLIC_SUPABASE_URL ו־NEXT_PUBLIC_SUPABASE_ANON_KEY
        (ראו docs/supabase.md).
      </p>
    </main>
  );
}
