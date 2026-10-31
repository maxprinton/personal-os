"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow, utcToLocal, zonedToUtc } from "@/lib/time";
import type { ActionState } from "@/app/actions";
import { ADJUSTMENT_CATEGORY, setRealBalance } from "@/lib/balance-adjust";

const ACCOUNT_KINDS = ["checking", "savings", "credit_card", "cash", "other"];

function refresh() {
  revalidatePath("/");
  revalidatePath("/finance");
}

function money(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export async function addTransaction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const type = String(form.get("type") ?? "expense") === "income" ? "income" : "expense";
  const amount = money(form.get("amount"));
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than 0." };

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const date = String(form.get("date") ?? "") || today;
  // Today -> now; another day -> noon of that day (keeps it on the right local date)
  const occurred_at = date === today ? new Date().toISOString() : zonedToUtc(date, "12:00", timezone).toISOString();

  const { error } = await supabase.from("transactions").insert({
    type,
    amount,
    occurred_at,
    category_id: String(form.get("category_id") ?? "") || null,
    account_id: String(form.get("account_id") ?? "") || null,
    description: String(form.get("description") ?? "").trim() || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

/** Picks (or clears) the account of an existing transaction; balances follow automatically. */
export async function setTransactionAccount(id: string, accountId: string | null): Promise<{ ok?: boolean; error?: string }> {
  if (!id) return { error: "Missing transaction." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .update({ account_id: accountId || null })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not save (transaction not found)." };
  refresh();
  return { ok: true };
}

/**
 * Saves the moment of an edited transaction. Same local day as before → keeps the exact time (so it stays
 * on the same side of the account's real balance); today → now; another day → noon of that day.
 */
function editedMoment(oldIso: string, date: string, today: string, tz: string) {
  if (date === utcToLocal(oldIso, tz).date) return oldIso;
  return date === today ? new Date().toISOString() : zonedToUtc(date, "12:00", tz).toISOString();
}

type CatRow = { id: string; name: string; kind: "income" | "expense" };

async function categoryFor(supabase: Awaited<ReturnType<typeof createClient>>, id: string, type: "income" | "expense") {
  if (!id) return { id: null as string | null };
  const { data } = await supabase.from("categories").select("id,name,kind").eq("id", id).is("deleted_at", null).maybeSingle();
  const c = data as CatRow | null;
  if (!c) return { error: "That category no longer exists." };
  if (c.kind !== type) return { error: `“${c.name}” is an ${c.kind} category. Pick one for ${type === "income" ? "income" : "expenses"}.` };
  return { id: c.id };
}

/** Edits every field of a transaction: type, amount, category, account, date and description. */
export async function updateTransaction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing transaction." };
  const type = String(form.get("type") ?? "expense") === "income" ? "income" : "expense";
  const amount = money(form.get("amount"));
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than 0." };
  const date = String(form.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date." };

  const supabase = await createClient();
  const { data: old } = await supabase.from("transactions").select("id,occurred_at").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!old) return { error: "That transaction no longer exists." };
  const cat = await categoryFor(supabase, String(form.get("category_id") ?? ""), type);
  if ("error" in cat) return { error: cat.error };

  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const { data, error } = await supabase
    .from("transactions")
    .update({
      type,
      amount,
      category_id: cat.id,
      account_id: String(form.get("account_id") ?? "") || null,
      description: String(form.get("description") ?? "").trim() || null,
      occurred_at: editedMoment(old.occurred_at as string, date, today, timezone),
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not save (transaction not found)." };
  // You looked at it: it is no longer an automatic guess (✨). Quietly skipped if migration 0026 isn't run yet.
  await supabase.from("transactions").update({ auto_category: null }).eq("id", id).not("auto_category", "is", null);
  refresh();
  return { ok: true, at: Date.now() };
}

/**
 * "I remember part of this adjustment": takes that part out of a Balance adjustment and saves it as its own
 * transaction (same account, same moment), so the real balance does not change. All of it → the adjustment goes away.
 */
export async function splitAdjustment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const amount = money(form.get("amount"));
  if (!id) return { error: "Missing adjustment." };
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than 0." };

  const supabase = await createClient();
  const { data: adj } = await supabase
    .from("transactions")
    .select("id,type,amount,account_id,occurred_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!adj) return { error: "That adjustment no longer exists." };
  const total = Number(adj.amount);
  if (amount > total) return { error: `That is more than the adjustment (${total.toFixed(2)}). Edit the adjustment itself instead.` };
  const type = adj.type as "income" | "expense";
  const cat = await categoryFor(supabase, String(form.get("category_id") ?? ""), type);
  if ("error" in cat) return { error: cat.error };

  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const date = String(form.get("date") ?? "") || utcToLocal(adj.occurred_at as string, timezone).date;
  const { error } = await supabase.from("transactions").insert({
    type,
    amount,
    category_id: cat.id,
    account_id: adj.account_id,
    description: String(form.get("description") ?? "").trim() || null,
    occurred_at: editedMoment(adj.occurred_at as string, date, today, timezone),
  });
  if (error) return { error: error.message };
  const left = Math.round((total - amount) * 100) / 100;
  await supabase
    .from("transactions")
    .update(left > 0 ? { amount: left } : { deleted_at: new Date().toISOString() })
    .eq("id", id);
  refresh();
  return { ok: true, at: Date.now() };
}

/** Renames a category; every transaction and budget in it follows. */
export async function renameCategory(id: string, name: string): Promise<{ ok?: boolean; error?: string }> {
  const clean = name.trim();
  if (!id) return { error: "Missing category." };
  if (!clean) return { error: "Name can't be empty." };
  const supabase = await createClient();
  const { data: cur } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
  if (!cur) return { error: "That category no longer exists." };
  const isAdj = (n: string) => n.toLowerCase() === ADJUSTMENT_CATEGORY.toLowerCase();
  if (isAdj(String(cur.name))) return { error: `“${ADJUSTMENT_CATEGORY}” is used for balance updates and keeps its name.` };
  if (isAdj(clean)) return { error: `“${ADJUSTMENT_CATEGORY}” is reserved for balance updates.` };
  const { error } = await supabase.from("categories").update({ name: clean }).eq("id", id);
  if (error) return { error: error.code === "23505" ? "A category with that name already exists." : error.message };
  refresh();
  return { ok: true };
}

/** Moves money between two of the user's accounts. Not income or expense. */
export async function addTransfer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const from = String(form.get("from_account_id") ?? "");
  const to = String(form.get("to_account_id") ?? "");
  const amount = money(form.get("amount"));
  if (!from || !to) return { error: "Pick both accounts." };
  if (from === to) return { error: "Pick two different accounts." };
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than 0." };

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const date = String(form.get("date") ?? "") || today;
  const occurred_at = date === today ? new Date().toISOString() : zonedToUtc(date, "12:00", timezone).toISOString();

  const { error } = await supabase.from("transfers").insert({
    from_account_id: from,
    to_account_id: to,
    amount,
    occurred_at,
    note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteTransfer(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transfers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function deleteTransaction(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  // If it was a confirmed payment, its event goes back to "due" (the draft shows again)
  await supabase
    .from("events")
    .update({ payment_status: null, payment_transaction_id: null })
    .eq("payment_transaction_id", id);
  refresh();
}

export async function addAccount(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Account name is required." };
  const kindRaw = String(form.get("kind") ?? "checking");
  const kind = ACCOUNT_KINDS.includes(kindRaw) ? kindRaw : "other";
  const opening = money(form.get("balance"));

  const supabase = await createClient();
  const { data, error } = await supabase.from("accounts").insert({ name, kind }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not create account." };
  if (opening !== null) {
    await supabase.from("balance_snapshots").insert({ account_id: data.id, amount: opening });
  }
  refresh();
  return { ok: true, at: Date.now() };
}

/** Manual override of the current balance (no need to log every penny). */
export async function updateBalance(form: FormData) {
  const accountId = String(form.get("account_id") ?? "");
  const amount = money(form.get("amount"));
  if (!accountId || amount === null) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  // The difference with the calculated balance becomes an "Adjustment" transaction (merma)
  await setRealBalance(supabase, user.id, accountId, amount, "web");
  refresh();
}

export async function deleteAccount(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("accounts").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function addCategory(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "expense") === "income" ? "income" : "expense";
  if (!name) return { error: "Category name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({ name, kind });
  if (error) return { error: error.code === "23505" ? "That category already exists." : error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function addStarterCategories() {
  const supabase = await createClient();
  const rows: { name: string; kind: "income" | "expense" }[] = [
    { name: "Food", kind: "expense" },
    { name: "Transport", kind: "expense" },
    { name: "Home", kind: "expense" },
    { name: "Health", kind: "expense" },
    { name: "Fun", kind: "expense" },
    { name: "Other", kind: "expense" },
    { name: "Salary", kind: "income" },
    { name: "Other income", kind: "income" },
  ];
  for (const r of rows) await supabase.from("categories").insert(r);
  refresh();
}

export async function setBudget(_prev: ActionState, form: FormData): Promise<ActionState> {
  const categoryId = String(form.get("category_id") ?? "");
  const limit = money(form.get("limit_amount"));
  const period = String(form.get("period") ?? "monthly") === "weekly" ? "weekly" : "monthly";
  if (!categoryId) return { error: "Pick a category." };
  if (limit === null || limit <= 0) return { error: "Enter a limit greater than 0." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("budgets")
    .select("id")
    .eq("category_id", categoryId)
    .eq("period", period)
    .is("deleted_at", null)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("budgets").update({ limit_amount: limit }).eq("id", existing.id)
    : await supabase.from("budgets").insert({ category_id: categoryId, limit_amount: limit, period });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteBudget(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("budgets").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function deleteCategory(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("budgets").update({ deleted_at: now }).eq("category_id", id).is("deleted_at", null);
  await supabase.from("transactions").update({ category_id: null }).eq("category_id", id);
  await supabase.from("categories").update({ deleted_at: now }).eq("id", id);
  refresh();
}
