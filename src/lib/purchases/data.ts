// Needs & Wants list (BL-116): database access shared by the Finance page, its server actions and Telegram.
// Every query filters by user_id, so it is safe with the admin client too (Telegram skips RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MISSING_TABLE,
  duplicateMessage,
  findOpenDuplicate,
  isDuplicateError,
  isMissingTable,
  listOf,
  nextPosition,
  normName,
  type PurchaseItem,
  type PurchaseKind,
} from "@/lib/purchases/rules";

const COLS = "id,name,price,kind,status,position,transaction_id,source,bought_at,created_at";

type Row = Omit<PurchaseItem, "price" | "txn"> & {
  price: number | string | null;
  transactions?: { amount: number | string; occurred_at: string; deleted_at: string | null } | null;
};

function toItem(r: Row): PurchaseItem {
  const t = r.transactions;
  return {
    id: r.id,
    name: r.name,
    price: r.price === null ? null : Number(r.price),
    kind: r.kind,
    status: r.status,
    position: r.position,
    transaction_id: r.transaction_id,
    source: r.source,
    bought_at: r.bought_at,
    created_at: r.created_at,
    txn: t && !t.deleted_at ? { amount: Number(t.amount), occurred_at: t.occurred_at } : null,
  };
}

/** All live items (open and bought), with each bought item's transaction. */
export async function listPurchases(
  sb: SupabaseClient,
  userId: string
): Promise<{ items: PurchaseItem[]; missing: boolean; error: string | null }> {
  const { data, error } = await sb
    .from("purchase_items")
    .select(`${COLS},transactions(amount,occurred_at,deleted_at)`)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("position")
    .limit(500);
  if (error) return { items: [], missing: isMissingTable(error), error: isMissingTable(error) ? MISSING_TABLE : error.message };
  return { items: ((data ?? []) as unknown as Row[]).map(toItem), missing: false, error: null };
}

export type AddResult = { ok: true; item: PurchaseItem; countInList: number } | { ok: false; error: string };

/** Adds an item at the bottom of its list. Same name already open -> refused (also enforced by the database). */
export async function addPurchase(
  sb: SupabaseClient,
  userId: string,
  input: { name: string; price: number | null; kind: PurchaseKind; source: "web" | "telegram" }
): Promise<AddResult> {
  const name = normName(input.name);
  if (!name) return { ok: false, error: "Write what you need or want." };
  if (input.price !== null && !(input.price > 0)) return { ok: false, error: "The price must be a number above 0, or empty." };
  const cur = await listPurchases(sb, userId);
  if (cur.error) return { ok: false, error: cur.error };
  const dup = findOpenDuplicate(cur.items, name);
  if (dup) return { ok: false, error: duplicateMessage(dup) };
  const { data, error } = await sb
    .from("purchase_items")
    .insert({ user_id: userId, name, price: input.price, kind: input.kind, source: input.source, position: nextPosition(cur.items, input.kind) })
    .select(COLS)
    .single();
  if (error || !data) {
    if (isDuplicateError(error)) return { ok: false, error: `“${name}” is already on your list.` };
    return { ok: false, error: isMissingTable(error) ? MISSING_TABLE : (error?.message ?? "Could not save it.") };
  }
  const item = toItem(data as unknown as Row);
  return { ok: true, item, countInList: listOf([...cur.items, item], item.kind).length };
}

/** Saves a list's order: position = index in `ids` (only open items of that list are touched). */
export async function saveOrder(sb: SupabaseClient, userId: string, kind: PurchaseKind, ids: string[]): Promise<string | null> {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await sb
      .from("purchase_items")
      .update({ position: i })
      .eq("id", ids[i])
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("status", "open");
    if (error) return error.message;
  }
  return null;
}
