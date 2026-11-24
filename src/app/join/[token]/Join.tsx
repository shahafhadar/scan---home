"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Result = { ok: boolean; error?: string } | null;

export function Join({ token }: { token: string }) {
  const [result, setResult] = useState<Result>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void supabaseBrowser()
      .rpc("accept_household_invite", { p_token: token })
      .then(({ data, error }) => setResult(error ? { ok: false, error: "ההצטרפות נכשלה" } : (data as Result)));
  }, [token]);

  if (!result) return <p className="text-muted">מצרפים אתכם…</p>;
  if (result.ok)
    return (
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-bold">הצטרפתם ✓</h1>
        <p className="text-muted">החשבון שלכם מחובר עכשיו למשק הבית המשותף.</p>
        <Link href="/" className="rounded-xl bg-accent text-accent-foreground py-3 px-6 font-medium">
          לרשימה
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="text-xl font-bold">ההזמנה לא בתוקף</h1>
      <p className="text-muted">{result.error ?? "ייתכן שההזמנה פגה, כבר נוצלה, או נשלחה לכתובת אחרת."}</p>
      <Link href="/" className="underline">
        לרשימה
      </Link>
    </div>
  );
}
