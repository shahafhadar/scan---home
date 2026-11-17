"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SendListButton } from "./SendListButton";

export type Item = {
  id: string;
  list_id: string;
  barcode: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  status: "pending" | "purchased" | "removed";
  identified: boolean;
  note: string | null;
  updated_at: string;
};

type List = { id: string; name: string; household_id: string };

/** Applies one realtime change to the items on screen. Exported for tests. */
export const applyChange = (items: Item[], incoming: Item, listId: string): Item[] => {
  const rest = items.filter((i) => i.id !== incoming.id);
  // Always replace with the whole row: a partial row once left an item with
  // no status, in neither section, invisible.
  return incoming.list_id === listId && incoming.status !== "removed" ? [incoming, ...rest] : rest;
};

const sorted = (items: Item[]) => [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

export function ShoppingList() {
  const supabase = supabaseBrowser();
  const [list, setList] = useState<List | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const { data: lists, error: listError } = await supabase
      .from("lists")
      .select("id, name, household_id")
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1);
    if (listError || !lists?.[0]) {
      setError("לא נמצאה רשימה פעילה");
      return;
    }
    setList(lists[0]);
    const { data, error: itemsError } = await supabase
      .from("list_items")
      .select("id, list_id, barcode, name, quantity, unit, status, identified, note, updated_at")
      .eq("list_id", lists[0].id)
      .neq("status", "removed");
    if (itemsError) setError("טעינת הרשימה נכשלה");
    else setItems(data as Item[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: a scan shows up here the moment it reaches the server.
  useEffect(() => {
    if (!list) return;
    const channel = supabase
      .channel(`items-${list.household_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "list_items", filter: `household_id=eq.${list.household_id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as Partial<Item>;
            setItems((current) => current.filter((i) => i.id !== gone.id));
          } else {
            setItems((current) => applyChange(current, payload.new as Item, list.id));
          }
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
        // Anything that happened while we were disconnected.
        if (status === "SUBSCRIBED") void load();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, list, load]);

  const update = async (item: Item, patch: Partial<Pick<Item, "status" | "quantity" | "name">>) => {
    setItems((current) => applyChange(current, { ...item, ...patch, updated_at: new Date().toISOString() }, item.list_id));
    const { error: updateError } = await supabase.from("list_items").update(patch).eq("id", item.id);
    if (updateError) {
      setError("השינוי לא נשמר");
      void load();
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || !list) return;
    setNewName("");
    const { error: insertError } = await supabase.from("list_items").insert({ list_id: list.id, name });
    if (insertError) setError("ההוספה נכשלה");
    void load();
  };

  // Naming happens inline in the row: window.prompt is clumsy on a phone and
  // blocked outright in some installed web apps.
  const [naming, setNaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const identify = async (event: React.FormEvent, item: Item) => {
    event.preventDefault();
    const name = nameDraft.trim();
    setNaming(null);
    if (!name || !item.barcode) return;
    setItems((current) => applyChange(current, { ...item, name, identified: true }, item.list_id));
    const { error: rpcError } = await supabase.rpc("identify_product", { p_barcode: item.barcode, p_name: name });
    if (rpcError) setError("שמירת השם נכשלה");
    void load();
  };

  const pending = useMemo(() => sorted(items.filter((i) => i.status === "pending")), [items]);
  const purchased = useMemo(() => sorted(items.filter((i) => i.status === "purchased")), [items]);

  return (
    <section className="pb-28">
      <header className="flex items-baseline gap-2 mb-4">
        <h1 className="text-2xl font-bold">{list?.name ?? "רשימת קניות"}</h1>
        {pending.length > 0 && <span className="text-sm text-muted">{pending.length} פריטים</span>}
        <span
          className={`text-xs ms-auto rounded-full px-2 py-0.5 ${live ? "bg-accent-soft text-accent" : "bg-border text-muted"}`}
          title={live ? "סריקות מופיעות כאן מיד" : "מתחבר מחדש…"}
        >
          {live ? "● חי" : "○ מתחבר"}
        </span>
      </header>

      {error && (
        <button className="mb-3 w-full text-start text-danger text-sm rounded-xl bg-surface border p-3" onClick={() => setError(null)}>
          {error}
        </button>
      )}

      {pending.length === 0 && (
        <div className="rounded-2xl bg-surface border p-8 text-center shadow-sm">
          <div className="text-4xl mb-2" aria-hidden="true">🛒</div>
          <p className="font-medium">הרשימה ריקה</p>
          <p className="text-sm text-muted mt-1">סורקים מוצר שנגמר, והוא מופיע כאן.</p>
          <a href="/setup" className="inline-block mt-4 text-sm text-accent font-medium">
            עוד אין סורק? להגדרת סורק חדש ←
          </a>
        </div>
      )}
      <ul className="rounded-2xl bg-surface border shadow-sm divide-y overflow-hidden">
        {pending.map((item) => (
          <li key={item.id} className="flex items-center gap-3 min-h-16 px-3 py-2">
            <label className="p-2 -m-2">
              <input
                type="checkbox"
                aria-label={`נקנה: ${item.name}`}
                onChange={() => update(item, { status: "purchased" })}
                className="size-6 accent-[var(--accent)] rounded-full"
              />
            </label>
            <div className="flex-1 min-w-0">
              {naming === item.id ? (
                <form onSubmit={(e) => identify(e, item)} className="flex gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => !nameDraft.trim() && setNaming(null)}
                    placeholder="שם המוצר"
                    enterKeyHint="done"
                    className="flex-1 min-w-0 border rounded-lg px-2 py-1.5 bg-background"
                  />
                  <button className="rounded-lg bg-accent text-accent-foreground px-3">שמירה</button>
                </form>
              ) : (
                <>
                  <div className={`truncate font-medium ${item.identified ? "" : "text-muted"}`}>{item.name}</div>
                  {!item.identified && (
                    <button
                      onClick={() => {
                        setNameDraft("");
                        setNaming(item.id);
                      }}
                      className="text-xs text-accent font-medium py-1"
                    >
                      + לתת שם למוצר
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-full bg-background p-1">
              <button
                aria-label="פחות"
                onClick={() => (item.quantity > 1 ? update(item, { quantity: item.quantity - 1 }) : update(item, { status: "removed" }))}
                className="size-9 rounded-full bg-surface border text-lg"
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums font-medium">{item.quantity}</span>
              <button aria-label="עוד" onClick={() => update(item, { quantity: item.quantity + 1 })} className="size-9 rounded-full bg-surface border text-lg">
                +
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pending.length > 0 && <SendListButton />}

      {purchased.length > 0 && (
        <details className="mt-6">
          <summary className="text-muted py-2 cursor-pointer">נקנו ({purchased.length})</summary>
          <ul className="rounded-2xl bg-surface border divide-y overflow-hidden mt-2">
            {purchased.map((item) => (
              <li key={item.id} className="flex items-center gap-3 min-h-12 px-3 py-2 text-muted">
                <label className="p-2 -m-2">
                  <input
                    type="checkbox"
                    checked
                    aria-label={`להחזיר לרשימה: ${item.name}`}
                    onChange={() => update(item, { status: "pending" })}
                    className="size-6 accent-[var(--accent)]"
                  />
                </label>
                <span className="line-through flex-1 truncate">{item.name}</span>
                <span className="tabular-nums">{item.quantity}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Adding by hand sits at the bottom, where a thumb reaches in a shop. */}
      <form
        onSubmit={add}
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-surface/95 backdrop-blur safe-bottom pt-3"
      >
        <div className="mx-auto max-w-lg px-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="להוסיף ידנית, למשל עגבניות"
            enterKeyHint="send"
            className="flex-1 min-w-0 border rounded-xl px-3 py-3 bg-background"
          />
          <button className="rounded-xl bg-accent text-accent-foreground px-5 font-medium">הוספה</button>
        </div>
      </form>
    </section>
  );
}
