"use server";
// Needs & Wants list (BL-116): the Finance page's actions. Works on phone and desktop.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow, zonedToUtc } from "@/lib/time";
import { addPurchase, listPurchases, saveOrder } from "@/lib/purchases/data";
import {
  MISSING_TABLE,
  duplicateMessage,
  findOpenDuplicate,
  isDuplicateError,
  isMissingTable,
  listOf,
  moveStep,
  moveTo,
  nextPosition,
  normName,
  parsePrice,
  type PurchaseKind,
} from "@/lib/purchases/rules";

export type PurchaseResult = { ok?: true; error?: string };

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}

function refresh() {
  revalidatePath("/finance");
}

function fail(e: unknown): PurchaseResult {
  return { error: e instanceof Error ? e.message : "Something went wrong." };
}

const isKind = (k: unknown): k is PurchaseKind => k === "need" || k === "want";

export async function addPurchaseItem(input: { name: string; price: string; kind: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const price = parsePrice(input.price);
    if (Number.isNaN(price)) return { error: "The price must be a number above 0, or empty." };
    const r = await addPurchase(c.sb, c.userId, { name: input.name, price, kind: isKind(input.kind) ? input.kind : "want", source: "web" });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function editPurchaseItem(input: { id: string; name: string; price: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const name = normName(input.name);
    if (!name) return { error: "The name can't be empty." };
    const price = parsePrice(input.price);
    if (Number.isNaN(price)) return { error: "The price must be a number above 0, or empty." };
    const cur = await listPurchases(c.sb, c.userId);
    if (cur.error) return { error: cur.error };
    const me = cur.items.find((i) => i.id === input.id);
    if (!me) return { error: "That item is gone." };
    if (me.status === "open") {
      const dup = findOpenDuplicate(cur.items, name, me.id);
      if (dup) return { error: duplicateMessage(dup) };
    }
    const { error } = await c.sb.from("purchase_items").update({ name, price }).eq("id", me.id).eq("user_id", c.userId);
    if (error) return { error: isDuplicateError(error) ? `“${name}” is already on your list.` : error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Up / down one step, or (with targetId) dragged onto another item of the same list. */
export async function reorderPurchaseItem(input: { id: string; dir?: "up" | "down"; targetId?: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const cur = await listPurchases(c.sb, c.userId);
    if (cur.error) return { error: cur.error };
    const me = cur.items.find((i) => i.id === input.id && i.status === "open");
    if (!me) return { error: "That item is gone." };
    const ids = listOf(cur.items, me.kind).map((i) => i.id);
    const next = input.targetId ? moveTo(ids, me.id, input.targetId) : moveStep(ids, me.id, input.dir ?? "up");
    if (next.join() === ids.join()) return { ok: true };
    const err = await saveOrder(c.sb, c.userId, me.kind, next);
    if (err) return { error: err };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Needed <-> Wanted. It goes to the bottom of the other list. */
export async function switchPurchaseKind(input: { id: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const cur = await listPurchases(c.sb, c.userId);
    if (cur.error) return { error: cur.error };
    const me = cur.items.find((i) => i.id === input.id && i.status === "open");
    if (!me) return { error: "That item is gone." };
    const kind: PurchaseKind = me.kind === "need" ? "want" : "need";
    const { error } = await c.sb
      .from("purchase_items")
      .update({ kind, position: nextPosition(cur.items, kind) })
      .eq("id", me.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Takes an open item off the list (soft delete). Bought items are undone instead. */
export async function removePurchaseItem(input: { id: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const { error } = await c.sb
      .from("purchase_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("user_id", c.userId)
      .eq("status", "open");
    if (error) return { error: isMissingTable(error) ? MISSING_TABLE : error.message };
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Bought: saves the transaction from the pre-filled form (you checked it), then marks the item Bought and links it.
 * If the item was bought meanwhile (another tab, a double tap), the new transaction is removed again.
 */
export async function buyPurchaseItem(input: {
  id: string;
  amount: string;
  accountId: string;
  categoryId: string;
  date: string;
  description: string;
}): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const amount = parsePrice(input.amount);
    if (amount === null || Number.isNaN(amount)) return { error: "Write the real amount you paid (above 0)." };
    const { timezone } = await getSettings(c.sb);
    const today = localNow(timezone).date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
    if (date > today) return { error: "The date can't be in the future." };
    const { data: item, error: e1 } = await c.sb
      .from("purchase_items")
      .select("id,name,status")
      .eq("id", input.id)
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (e1) return { error: isMissingTable(e1) ? MISSING_TABLE : e1.message };
    if (!item) return { error: "That item is gone." };
    if (item.status !== "open") return { error: "It's already marked as Bought." };

    const { data: txn, error: e2 } = await c.sb
      .from("transactions")
      .insert({
        user_id: c.userId,
        type: "expense",
        amount,
        description: input.description.trim() || (item.name as string),
        account_id: input.accountId || null,
        category_id: input.categoryId || null,
        occurred_at: date === today ? new Date().toISOString() : zonedToUtc(date, "12:00", timezone).toISOString(),
      })
      .select("id")
      .single();
    if (e2 || !txn) return { error: e2?.message ?? "Could not save the transaction." };

    const { data: marked, error: e3 } = await c.sb
      .from("purchase_items")
      .update({ status: "bought", transaction_id: txn.id, bought_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("user_id", c.userId)
      .eq("status", "open")
      .select("id");
    if (e3 || !marked?.length) {
      await c.sb.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", txn.id).eq("user_id", c.userId);
      return { error: e3?.message ?? "It was already marked as Bought. Nothing new was saved." };
    }
    revalidatePath("/");
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Undo Bought: the item goes back to its list AND its transaction is removed (soft delete).
 * The database trigger from migration 0073 moves the item back when the transaction is deleted.
 */
export async function undoPurchaseBought(input: { id: string }): Promise<PurchaseResult> {
  try {
    const c = await ctx();
    const cur = await listPurchases(c.sb, c.userId);
    if (cur.error) return { error: cur.error };
    const me = cur.items.find((i) => i.id === input.id && i.status === "bought");
    if (!me) return { error: "That item is not Bought any more." };
    const dup = findOpenDuplicate(cur.items, me.name, me.id);
    if (dup) return { error: `${duplicateMessage(dup)} Remove or rename that one first, then undo.` };
    if (me.transaction_id) {
      const { error } = await c.sb
        .from("transactions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", me.transaction_id)
        .eq("user_id", c.userId)
        .is("deleted_at", null);
      if (error) return { error: error.message };
    }
    // The trigger already reopened it; this also covers a Bought item whose transaction was already gone.
    await c.sb
      .from("purchase_items")
      .update({ status: "open", transaction_id: null, bought_at: null, position: nextPosition(cur.items, me.kind) })
      .eq("id", me.id)
      .eq("user_id", c.userId)
      .eq("status", "bought");
    revalidatePath("/");
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
