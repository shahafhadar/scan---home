"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

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

  const identify = async (item: Item) => {
    const name = window.prompt(`איך לקרוא למוצר ${item.barcode}?`, "");
    if (!name?.trim() || !item.barcode) return;
    const { error: rpcError } = await supabase.rpc("identify_product", { p_barcode: item.barcode, p_name: name.trim() });
    if (rpcError) setError("שמירת השם נכשלה");
    void load();
  };

  const pending = useMemo(() => sorted(items.filter((i) => i.status === "pending")), [items]);
  const purchased = useMemo(() => sorted(items.filter((i) => i.status === "purchased")), [items]);

  return (
    <section>
      <header className="flex items-baseline gap-2 mb-4">
        <h1 className="text-xl font-bold">{list?.name ?? "רשימת קניות"}</h1>
        <span className={`text-xs ${live ? "text-green-600" : "opacity-50"}`}>{live ? "● מחובר" : "○ לא מחובר"}</span>
      </header>

      {error && (
        <p className="mb-3 text-red-600" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <form onSubmit={add} className="flex gap-2 mb-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="להוסיף ידנית, למשל עגבניות"
          className="flex-1 border rounded-lg px-3 py-2 bg-transparent"
        />
        <button className="rounded-lg bg-foreground text-background px-4">הוספה</button>
      </form>

      {pending.length === 0 && <p className="opacity-60 py-6 text-center">הרשימה ריקה. סרקו משהו!</p>}
      <ul className="divide-y">
        {pending.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              aria-label={`נקנה: ${item.name}`}
              onChange={() => update(item, { status: "purchased" })}
              className="size-5"
            />
            <div className="flex-1">
              <div className={item.identified ? "" : "opacity-70"}>{item.name}</div>
              {!item.identified && (
                <button onClick={() => identify(item)} className="text-xs underline opacity-80">
                  לתת שם למוצר
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="פחות"
                onClick={() => (item.quantity > 1 ? update(item, { quantity: item.quantity - 1 }) : update(item, { status: "removed" }))}
                className="size-7 rounded-full border"
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums">{item.quantity}</span>
              <button aria-label="עוד" onClick={() => update(item, { quantity: item.quantity + 1 })} className="size-7 rounded-full border">
                +
              </button>
            </div>
          </li>
        ))}
      </ul>

      {purchased.length > 0 && (
        <details className="mt-6">
          <summary className="opacity-70">נקנו ({purchased.length})</summary>
          <ul className="divide-y mt-2">
            {purchased.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2 opacity-60">
                <input type="checkbox" checked onChange={() => update(item, { status: "pending" })} className="size-5" />
                <span className="line-through flex-1">{item.name}</span>
                <span className="tabular-nums">{item.quantity}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
