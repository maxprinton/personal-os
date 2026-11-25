"use server";
// Budget with buckets (BL-117): guided setup and the "skip saving" mark on a payment.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
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
  buckets: { name: string; monthly_amount: string }[];
};

export async function saveBudgetSetup(input: SetupInput): Promise<BudgetResult> {
  try {
    const c = await ctx();
    const { timezone } = await getSettings(c.sb);
    const today = localNow(timezone).date;
    const percent = parseMoney(input.savings_percent);
    const buckets = (input.buckets ?? []).map((b) => ({ name: String(b.name ?? "").trim(), monthly_amount: parseMoney(b.monthly_amount) }));
    const names = (input.names ?? ["", "", ""]).map((n) => String(n ?? "").trim()) as [string, string, string];
    const checked = {
      start_date: String(input.start_date || today),
      savings_percent: percent,
      opening_spending: parseMoney(input.opening_spending),
      opening_savings: parseMoney(input.opening_savings),
      names,
      buckets,
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

    // The extra buckets are replaced by the list in the form (they hold no history, only a monthly amount)
    const del = await c.sb.from("budget_buckets").delete().eq("user_id", c.userId);
    if (del.error) return { error: del.error.message };
    if (buckets.length) {
      const ins = await c.sb.from("budget_buckets").insert(buckets.map((b, i) => ({ user_id: c.userId, name: b.name, monthly_amount: r2(b.monthly_amount), position: i })));
      if (ins.error) return { error: ins.error.message };
    }
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
