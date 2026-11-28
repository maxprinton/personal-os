"use server";
// Budget with buckets (BL-117): guided setup and the "skip saving" mark on a payment.
// Budget v2 (BL-124): savings account, plan and cushion settings; the real-money check's Fix; debts and paying them back.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow, zonedToUtc } from "@/lib/time";
import { checkSetup, r2 } from "@/lib/budget/calc";
import { MISSING_BUDGET, isMissingBudget } from "@/lib/budget/data";

type BudgetResult = { ok?: true; error?: string };

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}

const fail = (e: unknown): BudgetResult => ({ error: e instanceof Error ? e.message : "Something went wrong." });

/** "12", "12.5", "12,5", "$12" -> number; empty -> 0; anything else -> NaN. */
function parseMoney(v: string): number {
  const t = String(v ?? "").trim().replace(/^\$/, "").replace(",", ".");
  if (!t) return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export type SetupInput = {
  start_date: string;
  savings_percent: string;
  counted_category_ids: string[];
  opening_spending: string;
  opening_savings: string;
  names: [string, string, string];
  /** BL-124: optional; left out = unchanged. "" = no savings account. */
  savings_account_id?: string;
  plan_income?: string;
  cushion_target?: string;
};

const MISSING_V2 = "This needs migration 0079 (MIGRACION-0079-budget-v2.sql).";
const isMissingV2 = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205" || /savings_account_id|plan_income|cushion_target|debts|budget_corrections|debt_id/.test(e.message ?? ""));

export async function saveBudgetSetup(input: SetupInput): Promise<BudgetResult> {
  try {
    const c = await ctx();
    const { timezone } = await getSettings(c.sb);
    const today = localNow(timezone).date;
    const percent = parseMoney(input.savings_percent);
    const names = (input.names ?? ["", "", ""]).map((n) => String(n ?? "").trim()) as [string, string, string];
    const checked = {
      start_date: String(input.start_date || today),
      savings_percent: percent,
      opening_spending: parseMoney(input.opening_spending),
      opening_savings: parseMoney(input.opening_savings),
      names,
    };
    const problem = checkSetup(checked);
    if (problem) return { error: problem };

    // Only income categories that really are the user's
    const ids = [...new Set((input.counted_category_ids ?? []).map(String))];
    let counted: string[] = [];
    if (ids.length) {
      const { data } = await c.sb.from("categories").select("id").eq("user_id", c.userId).eq("kind", "income").is("deleted_at", null).in("id", ids);
      counted = ((data ?? []) as { id: string }[]).map((r) => r.id);
    }

    const up = await c.sb.from("budget_settings").upsert(
      {
        user_id: c.userId,
        start_date: checked.start_date,
        savings_percent: r2(percent),
        counted_category_ids: counted,
        opening_spending: r2(checked.opening_spending),
        opening_savings: r2(checked.opening_savings),
        savings_name: names[0],
        fixed_name: names[1],
        spending_name: names[2],
      },
      { onConflict: "user_id" }
    );
    if (up.error) return { error: isMissingBudget(up.error) ? MISSING_BUDGET : up.error.message };

    // BL-124 settings (only the ones the form sent)
    const v2: Record<string, unknown> = {};
    if (input.plan_income !== undefined) {
      const n = parseMoney(input.plan_income);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: "The planned month must be 0 or more." };
      v2.plan_income = r2(n);
    }
    if (input.cushion_target !== undefined) {
      const n = parseMoney(input.cushion_target);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: "The savings goal must be 0 or more." };
      v2.cushion_target = r2(n);
    }
    if (input.savings_account_id !== undefined) {
      const id = String(input.savings_account_id || "");
      if (id) {
        const { data } = await c.sb.from("accounts").select("id").eq("user_id", c.userId).is("deleted_at", null).eq("id", id).maybeSingle();
        if (!data) return { error: "That savings account no longer exists. Reload the page." };
      }
      v2.savings_account_id = id || null;
    }
    if (Object.keys(v2).length) {
      const u2 = await c.sb.from("budget_settings").update(v2).eq("user_id", c.userId);
      if (u2.error) return { error: isMissingV2(u2.error) ? MISSING_V2 : u2.error.message };
    }

    // Extra buckets are envelopes now (migration 0077), edited in the Envelopes list, not here
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Skip (or undo the skip of) the saving on one payment. */
export async function setSavingSkip(form: FormData): Promise<void> {
  const id = String(form.get("transaction_id") ?? "");
  const skip = String(form.get("skip") ?? "") === "true";
  if (!id) return;
  try {
    const c = await ctx();
    if (skip) {
      await c.sb.from("budget_saving_skips").upsert({ transaction_id: id, user_id: c.userId }, { onConflict: "transaction_id" });
    } else {
      await c.sb.from("budget_saving_skips").delete().eq("transaction_id", id).eq("user_id", c.userId);
    }
    revalidatePath("/finance");
  } catch {
    // nothing to show on a plain form post; the page keeps its old numbers
  }
}

/**
 * The real-money check's Fix (BL-124 decision 9): a budget-only correction so the budget adds up to the accounts
 * again. `target` is where the gap goes (Spending money by default, or Savings).
 */
export async function addBudgetCorrection(input: { amount: number; target: string; note?: string }): Promise<BudgetResult> {
  try {
    const amount = r2(Number(input.amount));
    if (!Number.isFinite(amount) || amount === 0) return { error: "There is no gap to fix." };
    if (Math.abs(amount) > 1e7) return { error: "That gap is too large. Check your account balances first." };
    const target = input.target === "savings" ? "savings" : "spending";
    const c = await ctx();
    const { error } = await c.sb.from("budget_corrections").insert({ user_id: c.userId, amount, target, note: String(input.note ?? "").trim().slice(0, 200) || null });
    if (error) return { error: isMissingV2(error) ? MISSING_V2 : error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Undo the last Fix (soft delete). */
export async function undoLastCorrection(): Promise<BudgetResult> {
  try {
    const c = await ctx();
    const { data } = await c.sb.from("budget_corrections").select("id").eq("user_id", c.userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return { error: "Nothing to undo." };
    const { error } = await c.sb.from("budget_corrections").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
    if (error) return { error: error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A debt you owe (BL-124 decision 10): who and how much. */
export async function addDebt(input: { person: string; amount: string; note?: string }): Promise<BudgetResult> {
  try {
    const person = String(input.person ?? "").trim();
    const amount = parseMoney(input.amount);
    if (!person) return { error: "Who do you owe?" };
    if (person.length > 80) return { error: "Keep the name to 80 characters." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter how much you owe (more than 0)." };
    const c = await ctx();
    const { error } = await c.sb.from("debts").insert({ user_id: c.userId, person, amount: r2(amount), note: String(input.note ?? "").trim().slice(0, 200) || null });
    if (error) return { error: isMissingV2(error) ? MISSING_V2 : error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Remove a debt from the list (soft delete). Its payments stay as normal transactions. */
export async function removeDebt(id: string): Promise<BudgetResult> {
  try {
    const c = await ctx();
    const { error } = await c.sb.from("debts").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("user_id", c.userId);
    if (error) return { error: error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Pay part of a debt back: a normal expense in the "Debt payback" category, linked to the debt, so it comes out of
 * the Debt payback envelope and lowers what is left. Paying more than is left is refused.
 */
export async function payDebt(input: { debtId: string; amount: string; accountId: string; date: string }): Promise<BudgetResult> {
  try {
    const amount = parseMoney(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than 0." };
    const c = await ctx();
    const { data: debt, error: de } = await c.sb.from("debts").select("id,person,amount").eq("id", input.debtId).eq("user_id", c.userId).is("deleted_at", null).maybeSingle();
    if (de) return { error: isMissingV2(de) ? MISSING_V2 : de.message };
    if (!debt) return { error: "That debt is gone. Reload the page." };
    const { data: paidRows } = await c.sb.from("transactions").select("amount").eq("user_id", c.userId).eq("debt_id", debt.id).is("deleted_at", null);
    const paid = ((paidRows ?? []) as { amount: number | string }[]).reduce((n, r) => n + Number(r.amount), 0);
    const left = r2(Number(debt.amount) - paid);
    if (left <= 0) return { error: "This debt is already paid." };
    if (r2(amount) > left) return { error: `Only $${left.toFixed(2)} is left on this debt.` };
    const { data: cat } = await c.sb.from("categories").select("id").eq("user_id", c.userId).eq("kind", "expense").is("deleted_at", null).ilike("name", "debt payback").limit(1).maybeSingle();
    const { timezone } = await getSettings(c.sb);
    const today = localNow(timezone).date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
    const occurred_at = date === today ? new Date().toISOString() : zonedToUtc(date, "12:00", timezone).toISOString();
    const { error } = await c.sb.from("transactions").insert({
      user_id: c.userId,
      type: "expense",
      amount: r2(amount),
      occurred_at,
      category_id: cat?.id ?? null,
      account_id: input.accountId || null,
      description: `Paid back ${debt.person}`,
      debt_id: debt.id,
    });
    if (error) return { error: isMissingV2(error) ? MISSING_V2 : error.message };
    revalidatePath("/");
    revalidatePath("/finance", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Money taken out of the savings account (BL-124 follow-up, migration 0080): "used" lowers Savings,
 * "borrowed" keeps it and asks you to put it back. Only transfers out of your savings account can be marked.
 */
export async function markSavingsWithdrawal(transferId: string, kind: string): Promise<BudgetResult> {
  try {
    const k = kind === "borrowed" ? "borrowed" : "used";
    const c = await ctx();
    const { data: st } = await c.sb.from("budget_settings").select("savings_account_id").eq("user_id", c.userId).maybeSingle();
    const sid = (st as { savings_account_id?: string | null } | null)?.savings_account_id ?? null;
    if (!sid) return { error: "Pick your savings account in Budget settings first." };
    const { data: tr } = await c.sb.from("transfers").select("id,from_account_id").eq("id", transferId).eq("user_id", c.userId).is("deleted_at", null).maybeSingle();
    if (!tr) return { error: "That transfer is gone. Reload the page." };
    if (tr.from_account_id !== sid) return { error: "Only money taken out of your savings account can be marked." };
    const { error } = await c.sb.from("budget_savings_withdrawals").upsert({ transfer_id: transferId, user_id: c.userId, kind: k }, { onConflict: "transfer_id" });
    if (error) return { error: /budget_savings_withdrawals/.test(error.message) ? "This needs migration 0080 (MIGRACION-0080-savings-withdrawals.sql)." : error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
