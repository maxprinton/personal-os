import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getFinance } from "@/lib/finance";
import {
  accountBalance,
  budgetUsage,
  formatUSD,
  inRange,
  monthRange,
  spendingByCategory,
  totals,
} from "@/lib/money";
import { formatDateLong, localNow, utcToLocal } from "@/lib/time";
import {
  addStarterCategories,
  deleteAccount,
  deleteBudget,
  deleteTransaction,
  updateBalance,
} from "@/app/finance-actions";
import Nav from "@/components/Nav";
import { AccountForm, BudgetForm, CategoryForm, TransactionForm } from "@/components/FinanceForms";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  other: "Other",
};

export default async function FinancePage() {
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const { accounts, categories, budgets, snapshots, txns } = await getFinance(supabase, timezone);

  const month = monthRange(today);
  const monthTxns = txns.filter((t) => inRange(t, month));
  const sums = totals(monthTxns);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const balances = accounts.map((a) => ({ account: a, ...accountBalance(a.id, snapshots, txns) }));
  const netWorth = balances.reduce((s, b) => s + b.balance, 0);
  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  return (
    <>
      <Nav active="/finance" />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Finance</h1>
          <p className="text-sm text-neutral-500">Log what you can. A balance update fixes the rest.</p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: `${monthName} income`, value: sums.income, cls: "text-green-700" },
            { label: `${monthName} spent`, value: sums.expense, cls: "text-red-600" },
            { label: "Net this month", value: sums.net, cls: sums.net >= 0 ? "text-green-700" : "text-red-600" },
            { label: "All accounts", value: netWorth, cls: "" },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs text-neutral-500">{c.label}</p>
              <p className={`text-lg font-semibold ${c.cls}`}>{formatUSD(c.value)}</p>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">Add a transaction</h2>
          {categories.length === 0 && (
            <form action={addStarterCategories}>
              <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">
                Add starter categories (Food, Transport, Home, Health, Fun, Salary…)
              </button>
            </form>
          )}
          <TransactionForm
            today={today}
            categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-500">Budgets</h2>
          <ul className="space-y-2">
            {budgets.map((b) => {
              const u = budgetUsage(b, txns, today);
              const over = u.spent > u.limit;
              return (
                <li key={b.id} className="space-y-1 rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {catName.get(b.category_id) ?? "Category"}{" "}
                      <span className="text-xs font-normal text-neutral-500">{b.period}</span>
                    </p>
                    <p className={`text-sm ${over ? "text-red-600" : "text-neutral-500"}`}>
                      {formatUSD(u.spent)} / {formatUSD(u.limit)} · {over ? `${formatUSD(-u.left)} over` : `${formatUSD(u.left)} left`}
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100">
                    <div
                      className={`h-1.5 rounded-full ${over ? "bg-red-500" : u.pct > 80 ? "bg-amber-500" : "bg-neutral-900"}`}
                      style={{ width: `${Math.min(100, u.pct)}%` }}
                    />
                  </div>
                  <form action={deleteBudget} className="text-right">
                    <input type="hidden" name="id" value={b.id} />
                    <button className="text-xs text-neutral-400 hover:text-red-600">Remove</button>
                  </form>
                </li>
              );
            })}
            {budgets.length === 0 && <p className="text-sm text-neutral-400">No budgets yet.</p>}
          </ul>
          {expenseCats.length > 0 && <BudgetForm categories={expenseCats.map((c) => ({ id: c.id, name: c.name }))} />}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-500">Accounts</h2>
          <ul className="space-y-2">
            {balances.map(({ account, balance, snapshotAt }) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                <div>
                  <p className="font-medium">{account.name}</p>
                  <p className="text-xs text-neutral-500">
                    {KIND_LABEL[account.kind] ?? account.kind}
                    {snapshotAt ? ` · balance set ${formatDateLong(utcToLocal(snapshotAt, timezone).date)}` : " · no balance set"}
                  </p>
                </div>
                <p className={`text-lg font-semibold ${balance < 0 ? "text-red-600" : ""}`}>{formatUSD(balance)}</p>
                <div className="flex w-full items-center justify-end gap-2">
                  <form action={updateBalance} className="flex items-center gap-1">
                    <input type="hidden" name="account_id" value={account.id} />
                    <input name="amount" inputMode="decimal" placeholder="Real balance" className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                    <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs">Update</button>
                  </form>
                  <form action={deleteAccount}>
                    <input type="hidden" name="id" value={account.id} />
                    <button className="text-xs text-neutral-400 hover:text-red-600">Remove</button>
                  </form>
                </div>
              </li>
            ))}
            {accounts.length === 0 && <p className="text-sm text-neutral-400">No accounts yet.</p>}
          </ul>
          <AccountForm />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">{monthName} spending by category</h2>
          <ul className="space-y-1 text-sm">
            {spendingByCategory(monthTxns).map(([id, amount]) => (
              <li key={id || "none"} className="flex justify-between border-b border-neutral-100 py-1">
                <span>{id ? catName.get(id) ?? "Category" : "Uncategorized"}</span>
                <span>{formatUSD(amount)}</span>
              </li>
            ))}
            {sums.expense === 0 && <p className="text-neutral-400">No expenses this month.</p>}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">Recent transactions</h2>
          <ul className="space-y-1">
            {txns.slice(0, 40).map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-neutral-100 py-2 text-sm">
                <span className="w-24 shrink-0 text-neutral-500">{t.localDate.slice(5)}</span>
                <span className="flex-1">
                  {t.description || (t.category_id ? catName.get(t.category_id) : null) || (t.type === "income" ? "Income" : "Expense")}
                  <span className="text-xs text-neutral-400">
                    {t.category_id && t.description ? ` · ${catName.get(t.category_id) ?? ""}` : ""}
                    {t.account_id ? ` · ${accName.get(t.account_id) ?? ""}` : ""}
                  </span>
                </span>
                <span className={t.type === "income" ? "text-green-700" : ""}>
                  {t.type === "income" ? "+" : "−"}{formatUSD(t.amount)}
                </span>
                <form action={deleteTransaction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="text-xs text-neutral-400 hover:text-red-600">×</button>
                </form>
              </li>
            ))}
            {txns.length === 0 && <p className="text-sm text-neutral-400">No transactions yet.</p>}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">Categories</h2>
          <p className="text-sm text-neutral-500">
            {categories.map((c) => `${c.name} (${c.kind})`).join(" · ") || "None yet."}
          </p>
          <CategoryForm />
        </section>
      </main>
    </>
  );
}
