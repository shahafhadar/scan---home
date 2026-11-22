"use client";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { supabaseBrowser } from "@/lib/supabase/client";

export function NoAccess() {
  const router = useRouter();
  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <main className="mx-auto max-w-sm px-5 pt-[max(6rem,env(safe-area-inset-top))] flex flex-col items-center text-center gap-4">
      <Logo size={64} />
      <h1 className="text-xl font-bold">אין גישה לחשבון</h1>
      <p className="text-muted">החשבון הזה אינו פעיל כרגע, ולכן לא ניתן להיכנס. אם לדעתכם מדובר בטעות, פנו אלינו.</p>
      <button onClick={signOut} className="rounded-xl border py-3 px-6 font-medium">
        יציאה
      </button>
    </main>
  );
}
