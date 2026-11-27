import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { addDays, localNow, utcToLocal } from "@/lib/time";
import { formatUSD } from "@/lib/money";
import { matchesMovements, parseMovementsQuery } from "@/lib/finance-charts";
import TransactionList from "@/components/TransactionList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Movements · Finance · Personal OS" };

type Row = { id: string; account_id: string | null; category_id: string | null; type: "income" | "expense"; amount: number | string; description: string | null; occurred_at: string };

/** BL-122: the movements behind a bar of the Charts page. ?from=&to=&type=income|expense&cats=id,id|none|removed&adj=only|exclude */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; type?: string; cats?: string; adj?: string }> }) {
  const raw = await searchParams;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const q = parseMovementsQuery(raw, today);
  const userId = await currentUserId(supabase);

  const back = (
    <div>
      <Link href="/finance/charts" className="text-sm text-accent hover:underline">← Charts</Link>
      <h1 className="mt-2 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Movements</h1>
    </div>
  );
  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
        {back}
        <p className="text-sm text-faint">Sign in to see your movements.</p>
      </main>
    );
  }

  const [catRes, accRes] = await Promise.all([
    supabase.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null).order("name"),
    supabase.from("accounts").select("id,name").eq("user_id", userId).is("deleted_at", null).order("created_at"),
  ]);
  const categories = (catRes.data ?? []) as { id: string; name: string; kind: "income" | "expense" }[];
  const accounts = (accRes.data ?? []) as { id: string; name: string }[];

  // Read the range in pages of 1000 (one day of margin: the stored time is UTC), then keep the exact local days
  const rows: Row[] = [];
  let failed = false;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id,account_id,category_id,type,amount,description,occurred_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("occurred_at", `${addDays(q.from, -1)}T00:00:00Z`)
      .lt("occurred_at", `${addDays(q.to, 2)}T00:00:00Z`)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (error) {
      failed = true;
      break;
    }
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const txns = rows
    .map((r) => ({ ...r, amount: Number(r.amount), localDate: utcToLocal(r.occurred_at, timezone).date }))
    .filter((t) => matchesMovements({ type: t.type, amount: t.amount, category_id: t.category_id, localDate: t.localDate }, q, categories));

  const ids = new Set(txns.map((t) => t.id));
  // ✨ choices of the app and "was it worth it?" answers (quietly empty if those migrations are not there)
  const autoRes = await supabase.from("transactions").select("id").is("deleted_at", null).not("category_id", "is", null).not("auto_category", "is", null).limit(1000);
  const autoIds = autoRes.error ? [] : ((autoRes.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => ids.has(id));
  const worthRes = await supabase.from("transactions").select("id,worth_it").is("deleted_at", null).not("worth_it", "is", null).limit(1000);
  const worthOf = new Map<string, boolean>(worthRes.error ? [] : ((worthRes.data ?? []) as { id: string; worth_it: boolean }[]).map((r) => [r.id, r.worth_it]));

  const income = txns.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const catLabels = q.cats.map((c) => (c === "none" ? "No category" : c === "removed" ? "Removed category" : catName.get(c) ?? "Category"));
  const filters = [
    `${q.from} → ${q.to}`,
    q.type === "income" ? "Income" : q.type === "expense" ? "Expenses" : null,
    q.adj === "only" ? "Balance adjustments only" : q.adj === "exclude" ? "Without balance adjustments" : null,
    q.cats.length && !(q.adj === "only") ? (catLabels.length > 4 ? `${catLabels.length} categories` : catLabels.join(", ")) : null,
  ].filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
      {back}
      <section className="card space-y-1 p-4">
        <p className="text-sm text-muted">{filters.join(" · ")}</p>
        <p className="text-sm">
          <b>{txns.length}</b> movement{txns.length === 1 ? "" : "s"}
          {income > 0 && <> · income <b className="tabular-nums text-success">{formatUSD(income)}</b></>}
          {expense > 0 && <> · expenses <b className="tabular-nums text-danger">{formatUSD(expense)}</b></>}
        </p>
        <p className="text-xs text-faint">Transfers between your accounts are never included.</p>
      </section>
      {failed && <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">Some movements could not load. Refresh in a moment.</p>}
      {txns.length === 0 && !failed ? (
        <p className="text-sm text-faint">Nothing matches these filters.</p>
      ) : (
        <TransactionList
          txns={txns.map((t) => ({ id: t.id, type: t.type, amount: t.amount, description: t.description, category_id: t.category_id, account_id: t.account_id, localDate: t.localDate, worth_it: worthOf.get(t.id) ?? null }))}
          categories={categories}
          accounts={accounts}
          today={today}
          autoIds={autoIds}
          proposals={[]}
        />
      )}
    </main>
  );
}
