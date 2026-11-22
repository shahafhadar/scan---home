"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Member = { user_id: string; email: string; role: "owner" | "member" | "viewer" };
type Invite = { token: string; email: string; role: string };

const roleLabel = (r: string): string => ({ owner: "בעלים", member: "חבר", viewer: "צופה" })[r] ?? r;

export function Household({
  householdId,
  myRole,
  myUserId,
}: {
  householdId: string | null;
  myRole: string | null;
  myUserId: string;
}) {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const isOwner = myRole === "owner";

  const load = useCallback(async () => {
    if (!householdId) return;
    const { data: m } = await supabase.rpc("list_household_members", { p_household_id: householdId });
    setMembers((m ?? []) as Member[]);
    const { data: inv } = await supabase
      .from("household_invites")
      .select("token,email,role")
      .eq("household_id", householdId)
      .is("used_at", null);
    setInvites((inv ?? []) as Invite[]);
  }, [supabase, householdId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!householdId) return <p className="text-muted">אין משק בית לנהל.</p>;

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setLink(null);
    const { data, error } = await supabase.rpc("create_household_invite", {
      p_household_id: householdId,
      p_email: email,
      p_role: role,
    });
    if (error || !data) {
      setProblem("ההזמנה נכשלה");
      return;
    }
    setLink(`${window.location.origin}/join/${data}`);
    setEmail("");
    void load();
  };

  const act = async (fn: PromiseLike<{ error: unknown }>, fail: string) => {
    const { error } = await fn;
    if (error) setProblem(fail);
    void load();
  };

  const leave = async () => {
    const { error } = await supabase.rpc("leave_household", { p_household_id: householdId });
    if (error) {
      setProblem("לא ניתן לעזוב (ייתכן שאתם הבעלים היחידים).");
      return;
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-5 md:max-w-lg">
      <h1 className="text-xl font-bold">בני הבית והרשאות</h1>

      <div className="rounded-2xl bg-surface border p-4 shadow-sm">
        <h2 className="font-bold mb-2">חברים</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-2">
              <span dir="ltr" className="text-sm truncate">
                {m.email}
                {m.user_id === myUserId && " (אתם)"}
              </span>
              {isOwner && m.user_id !== myUserId ? (
                <span className="flex items-center gap-2">
                  <select
                    value={m.role}
                    onChange={(e) => void act(supabase.rpc("set_member_role", { p_household_id: householdId, p_user_id: m.user_id, p_role: e.target.value }), "שינוי התפקיד נכשל")}
                    className="border rounded-lg px-2 py-1 text-sm bg-background"
                  >
                    <option value="owner">בעלים</option>
                    <option value="member">חבר</option>
                    <option value="viewer">צופה</option>
                  </select>
                  <button
                    onClick={() => void act(supabase.rpc("remove_household_member", { p_household_id: householdId, p_user_id: m.user_id }), "ההסרה נכשלה")}
                    className="text-danger text-sm"
                  >
                    הסרה
                  </button>
                </span>
              ) : (
                <span className="text-sm text-muted">{roleLabel(m.role)}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isOwner && (
        <div className="rounded-2xl bg-surface border p-4 shadow-sm">
          <h2 className="font-bold mb-2">הזמנת אדם</h2>
          <form onSubmit={invite} className="flex flex-col gap-2">
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="border rounded-xl px-3 py-2 bg-background"
            />
            <div className="flex gap-2">
              <select value={role} onChange={(e) => setRole(e.target.value as "member" | "viewer")} className="border rounded-xl px-3 py-2 bg-background">
                <option value="member">חבר (יכול לסרוק ולשלוט)</option>
                <option value="viewer">צופה (צפייה בלבד)</option>
              </select>
              <button className="rounded-xl bg-accent text-accent-foreground px-4 font-medium">הזמנה</button>
            </div>
          </form>
          {link && (
            <div className="mt-3">
              <p className="text-sm text-muted mb-1">שלחו את הקישור הזה למי שהזמנתם:</p>
              <input readOnly dir="ltr" value={link} onFocus={(e) => e.currentTarget.select()} className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
            </div>
          )}
          {invites.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {invites.map((i) => (
                <li key={i.token} className="flex items-center justify-between gap-2">
                  <span dir="ltr" className="text-muted truncate">
                    {i.email} · {roleLabel(i.role)}
                  </span>
                  <button onClick={() => void act(supabase.rpc("revoke_household_invite", { p_token: i.token }), "הביטול נכשל")} className="text-danger">
                    ביטול
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button onClick={leave} className="rounded-xl border py-3 font-medium self-start px-6">
        עזיבת משק הבית
      </button>
      {problem && <p className="text-danger text-sm">{problem}</p>}
    </section>
  );
}
