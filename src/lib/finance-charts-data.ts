// BL-122: reads what the Charts page needs (works with the signed-in client, RLS). Lean on purpose (free plan):
// only type, amount, category and date of non-deleted transactions inside the span, read in pages of 1000.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, utcToLocal } from "@/lib/time";
import type { ChartCat, ChartTxn } from "@/lib/finance-charts";

type Row = { type: "income" | "expense"; amount: number | string; category_id: string | null; occurred_at: string };

export async function loadChartData(sb: SupabaseClient, userId: string, tz: string, start: string, end: string): Promise<{ txns: ChartTxn[]; cats: ChartCat[] }> {
  // One day of margin on each side, because the stored time is UTC; the exact local day is checked after reading.
  const fromIso = `${addDays(start, -1)}T00:00:00Z`;
  const toIso = `${addDays(end, 2)}T00:00:00Z`;
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("transactions")
      .select("type,amount,category_id,occurred_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      .order("occurred_at")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const cat = await sb.from("categories").select("id,name").eq("user_id", userId).is("deleted_at", null);
  const txns = rows
    .map((r) => ({ type: r.type, amount: Number(r.amount), category_id: r.category_id, localDate: utcToLocal(r.occurred_at, tz).date }))
    .filter((t) => t.localDate >= start && t.localDate <= end);
  return { txns, cats: (cat.data ?? []) as ChartCat[] };
}
