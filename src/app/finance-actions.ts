"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow, zonedToUtc } from "@/lib/time";
import type { ActionState } from "@/app/actions";

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

export async function deleteTransaction(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
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
  await supabase.from("balance_snapshots").insert({ account_id: accountId, amount });
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
