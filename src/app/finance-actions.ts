"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow, utcToLocal, zonedToUtc } from "@/lib/time";
import type { ActionState } from "@/app/actions";
import { ADJUSTMENT_CATEGORY, setRealBalance } from "@/lib/balance-adjust";
import { snapshotDeltas, type SnapshotPrompt } from "@/lib/finance-ledger";
import { currentPeriodStart } from "@/lib/budget-rollover";

const ACCOUNT_KINDS = ["checking", "savings", "credit_card", "cash", "other"];

function refresh() {
  revalidatePath("/");
  revalidatePath("/finance", "layout");
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

  const { data: created, error } = await supabase
    .from("transactions")
    .insert({
      type,
      amount,
      occurred_at,
      category_id: String(form.get("category_id") ?? "") || null,
      account_id: String(form.get("account_id") ?? "") || null,
      description: String(form.get("description") ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  // BL-117: "don't set aside savings from this one". The payment is saved either way; a failed mark only means saving is taken.
  if (type === "income" && form.get("skip_saving") && created?.id) {
    await supabase.from("budget_saving_skips").upsert({ transaction_id: created.id }, { onConflict: "transaction_id" });
  }
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
  // "Was it worth it?" (only for expenses). Quietly skipped if migration 0050 isn't run yet.
  const worth = String(form.get("worth_it") ?? "");
  await supabase.from("transactions").update({ worth_it: type === "expense" && worth ? worth === "yes" : null }).eq("id", id);
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

type Sb = Awaited<ReturnType<typeof createClient>>;
type Done = { ok?: boolean; error?: string };

/** The amount a month starts with (one row per envelope and month; a second change in the same month replaces it). */
async function recordLimit(supabase: Sb, budgetId: string, limit: number, start: string) {
  await supabase
    .from("budget_limit_changes")
    .upsert({ budget_id: budgetId, limit_amount: limit, effective_from: start }, { onConflict: "budget_id,effective_from" });
}

/**
 * Create or edit an envelope (migration 0077): a name, a monthly amount and zero or more expense categories.
 * A category can be in one envelope only. A new amount counts for the whole current month.
 */
export async function saveEnvelope(input: { id?: string | null; name: string; amount: string; categoryIds: string[] }): Promise<Done> {
  const amount = money(input.amount);
  const name = String(input.name ?? "").trim();
  const ids = [...new Set((input.categoryIds ?? []).map(String).filter(Boolean))];
  if (amount === null || amount <= 0) return { error: "Enter a monthly amount greater than 0." };
  if (name.length > 40) return { error: "Keep the name to 40 characters." };
  if (!name && !ids.length) return { error: "Give the envelope a name or pick at least one category." };

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { error: "You are signed out. Sign in again." };
  const start = currentPeriodStart(localNow((await getSettings(supabase)).timezone).date, "monthly");

  if (ids.length) {
    const { data: cats } = await supabase.from("categories").select("id").eq("kind", "expense").is("deleted_at", null).in("id", ids);
    if ((cats ?? []).length !== ids.length) return { error: "One of those categories no longer exists. Reload the page." };
    const { data: taken } = await supabase
      .from("budget_categories")
      .select("budget_id,category_id,budgets!inner(id,deleted_at)")
      .in("category_id", ids)
      .is("budgets.deleted_at", null);
    const clash = ((taken ?? []) as { budget_id: string }[]).find((t) => t.budget_id !== input.id);
    if (clash) return { error: "A category you picked is already in another envelope. Take it out of that one first." };
  }

  let id = input.id ?? null;
  if (id) {
    const { data: cur } = await supabase.from("budgets").select("id,limit_amount").eq("id", id).is("deleted_at", null).maybeSingle();
    if (!cur) return { error: "That envelope is gone. Reload the page." };
    const { error } = await supabase.from("budgets").update({ name: name || null, limit_amount: amount, category_id: ids[0] ?? null }).eq("id", id);
    if (error) return { error: /budgets_uq/.test(error.message) ? "A category you picked is already in another envelope." : error.message };
    await supabase.from("budget_categories").delete().eq("budget_id", id);
    if (Number(cur.limit_amount) !== amount) await recordLimit(supabase, id, amount, start);
  } else {
    const { data: last } = await supabase.from("budgets").select("position").is("deleted_at", null).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await supabase
      .from("budgets")
      .insert({ name: name || null, category_id: ids[0] ?? null, limit_amount: amount, period: "monthly", started_on: start, position: Number(last?.position ?? 0) + 1 })
      .select("id")
      .single();
    if (error) return { error: /budgets_uq/.test(error.message) ? "A category you picked is already in another envelope." : error.message };
    id = row.id as string;
    await recordLimit(supabase, id, amount, start);
  }
  if (ids.length) {
    const { error } = await supabase.from("budget_categories").insert(ids.map((category_id) => ({ budget_id: id, category_id, user_id: userId })));
    if (error) return { error: /one_envelope/.test(error.message) ? "A category you picked is already in another envelope." : error.message };
  }
  refresh();
  return { ok: true };
}

/** The rollover switch of an envelope. On: counting starts with the current month. Off: the carry is forgotten. */
export async function setBudgetRollover(id: string, on: boolean): Promise<Done> {
  const supabase = await createClient();
  const { data: b } = await supabase.from("budgets").select("id,period").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!b) return { error: "That envelope is gone. Reload the page." };
  const start = currentPeriodStart(localNow((await getSettings(supabase)).timezone).date, b.period as "weekly" | "monthly");
  const { error } = await supabase
    .from("budgets")
    .update({ rollover: on, rollover_since: on ? start : null })
    .eq("id", id);
  if (error) return { error: /rollover/.test(error.message) ? "Rollover needs migration 0076 (MIGRACION-0076-budget-rollover.sql)." : error.message };
  refresh();
  return { ok: true };
}

/** Remove an envelope: its money goes back to Spending money and its categories are free again. */
export async function deleteBudget(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("budgets").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  await supabase.from("budget_categories").delete().eq("budget_id", id);
  refresh();
}

export async function deleteCategory(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  // Envelopes lose this category; one left with no category and no typed name was only this category's budget
  const { data: links } = await supabase.from("budget_categories").select("budget_id").eq("category_id", id);
  await supabase.from("budget_categories").delete().eq("category_id", id);
  for (const l of (links ?? []) as { budget_id: string }[]) {
    const [{ data: env }, { count }] = await Promise.all([
      supabase.from("budgets").select("id,name").eq("id", l.budget_id).maybeSingle(),
      supabase.from("budget_categories").select("category_id", { count: "exact", head: true }).eq("budget_id", l.budget_id),
    ]);
    if (env && !env.name && !count) await supabase.from("budgets").update({ deleted_at: now }).eq("id", l.budget_id);
    else await supabase.from("budgets").update({ category_id: null }).eq("id", l.budget_id).eq("category_id", id);
  }
  await supabase.from("budgets").update({ deleted_at: now }).eq("category_id", id).is("deleted_at", null);
  await supabase.from("transactions").update({ category_id: null }).eq("category_id", id);
  await supabase.from("categories").update({ deleted_at: now }).eq("id", id);
  refresh();
}

/**
 * BL-101: same as updateTransaction, plus: when the edited transaction is dated before an account's latest
 * balance snapshot, returns what that snapshot would need to change by, so the page can ask
 * "adjust the snapshot too, or leave the balance as it is?". Nothing is changed here besides the transaction.
 */
export async function updateTransactionForAccount(
  _prev: ActionState & { prompts?: SnapshotPrompt[] },
  form: FormData
): Promise<ActionState & { prompts?: SnapshotPrompt[] }> {
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const sel = "type,amount,account_id,occurred_at";
  const { data: old } = id ? await supabase.from("transactions").select(sel).eq("id", id).is("deleted_at", null).maybeSingle() : { data: null };
  const res = await updateTransaction(_prev, form);
  if (!res.ok || !old) return res;
  const { data: nw } = await supabase.from("transactions").select(sel).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!nw) return res;
  const norm = (r: { type: unknown; amount: unknown; account_id: unknown; occurred_at: unknown }) => ({
    type: (r.type === "income" ? "income" : "expense") as "income" | "expense",
    amount: Number(r.amount),
    account_id: (r.account_id as string | null) ?? null,
    occurred_at: String(r.occurred_at),
  });
  const before = norm(old);
  const after = norm(nw);
  const ids = [...new Set([before.account_id, after.account_id].filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return res;
  const [{ data: snaps }, { data: accs }, settings] = await Promise.all([
    supabase.from("balance_snapshots").select("id,account_id,recorded_at").in("account_id", ids).is("deleted_at", null),
    supabase.from("accounts").select("id,name").in("id", ids),
    getSettings(supabase),
  ]);
  const latest = new Map<string, { id: string; recorded_at: string }>();
  for (const sn of (snaps ?? []) as { id: string; account_id: string; recorded_at: string }[]) {
    const cur = latest.get(sn.account_id);
    if (!cur || sn.recorded_at > cur.recorded_at) latest.set(sn.account_id, { id: sn.id, recorded_at: sn.recorded_at });
  }
  const cutoffs = new Map([...latest].map(([acc, v]) => [acc, v.recorded_at]));
  const names = new Map(((accs ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const prompts: SnapshotPrompt[] = snapshotDeltas(before, after, cutoffs).map((d) => ({
    accountId: d.accountId,
    accountName: names.get(d.accountId) ?? "Account",
    snapshotId: latest.get(d.accountId)!.id,
    snapshotDate: utcToLocal(latest.get(d.accountId)!.recorded_at, settings.timezone).date,
    delta: d.delta,
  }));
  return prompts.length ? { ...res, prompts } : res;
}

/** BL-101: moves a balance snapshot by the difference, so the current balance moves by the same amount. */
export async function adjustSnapshot(snapshotId: string, delta: number): Promise<{ ok?: boolean; error?: string }> {
  if (!snapshotId || !Number.isFinite(delta) || delta === 0) return { error: "Nothing to adjust." };
  const supabase = await createClient();
  const { data: snap } = await supabase.from("balance_snapshots").select("id,amount").eq("id", snapshotId).is("deleted_at", null).maybeSingle();
  if (!snap) return { error: "That balance snapshot no longer exists." };
  const amount = Math.round((Number(snap.amount) + delta) * 100) / 100;
  const { error } = await supabase.from("balance_snapshots").update({ amount }).eq("id", snapshotId);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}
