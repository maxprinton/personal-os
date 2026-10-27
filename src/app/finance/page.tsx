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
  deleteCategory,
  deleteTransaction,
  deleteTransfer,
  updateBalance,
} from "@/app/finance-actions";
import TxnAccountSelect from "@/components/TxnAccountSelect";
import { AccountForm, BudgetForm, CategoryForm, TransactionForm, TransferForm } from "@/components/FinanceForms";
import { EditPaymentButton, PaymentDraft, PaymentForm, StopPaymentButton, PaymentRow, TemplateAccountSelect } from "@/components/PaymentForms";
import { currentUserId } from "@/lib/calendar/model";
import { getDuePayments, getPaymentTemplates } from "@/lib/calendar/payments";
import { describeRepeat } from "@/lib/calendar/recurrence";
import { addDays } from "@/lib/time";
import { isMobileRequest } from "@/lib/device";

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
  const { accounts, categories, budgets, snapshots, txns, transfers } = await getFinance(supabase, timezone);
  const userId = await currentUserId(supabase);
  const mobile = await isMobileRequest();
  const templates = userId ? await getPaymentTemplates(supabase, userId) : [];
  const due = userId ? await getDuePayments(supabase, userId, today) : [];
  // Payment events of the last month and the next one: upcoming ones can be paid early, paid ones show what was recorded
  const { data: payEventsData } = await supabase
    .from("events")
    .select("id,title,event_date,payment_template_id,payment_status,payment_expected_amount")
    .eq("is_payment", true)
    .is("deleted_at", null)
    .gte("event_date", addDays(today, -31))
    .lte("event_date", addDays(today, 62))
    .order("event_date");
  type PayEvent = {
    id: string;
    title: string;
    event_date: string;
    payment_template_id: string | null;
    payment_status: "paid" | "skipped" | null;
    payment_expected_amount: number | null;
  };
  const payEvents = ((payEventsData ?? []) as (Omit<PayEvent, "payment_expected_amount"> & { payment_expected_amount: number | string | null })[]).map(
    (e) => ({ ...e, payment_expected_amount: e.payment_expected_amount === null ? null : Number(e.payment_expected_amount) })
  );
  const dueIds = new Set(due.map((p) => p.eventId));
  const upcoming = payEvents.filter((e) => !e.payment_status && e.event_date > today && e.event_date <= addDays(today, 31));
  const recent = payEvents.filter((e) => e.payment_status && e.event_date <= today).reverse().slice(0, 8);
  // Each scheduled payment's next one still to pay (due, overdue or upcoming)
  const nextUnpaid = new Map<string, PayEvent>();
  for (const e of payEvents) {
    if (e.payment_status || !e.payment_template_id || nextUnpaid.has(e.payment_template_id)) continue;
    if (e.event_date < today && !dueIds.has(e.id)) continue;
    nextUnpaid.set(e.payment_template_id, e);
  }
  const payOptions = {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  };

  const month = monthRange(today);
  const monthTxns = txns.filter((t) => inRange(t, month));
  const sums = totals(monthTxns);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const balances = accounts.map((a) => ({ account: a, ...accountBalance(a.id, snapshots, txns, transfers) }));
  const netWorth = balances.reduce((s, b) => s + b.balance, 0);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name }));
  const unassigned = accounts.length > 0 ? txns.filter((t) => !t.account_id) : [];
  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  return (
    <>
      <main className="@container mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="text-sm text-muted">Log what you can. A balance update fixes the rest.</p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: `${monthName} income`, value: sums.income, cls: "text-success" },
            { label: `${monthName} spent`, value: sums.expense, cls: "text-danger" },
            { label: "Net this month", value: sums.net, cls: sums.net >= 0 ? "text-success" : "text-danger" },
            { label: "All accounts", value: netWorth, cls: "" },
          ].map((c) => (
            <div key={c.label} className="card p-4">
              <p className="text-xs text-muted">{c.label}</p>
              <p className={`text-2xl font-semibold tabular-nums tracking-tight ${c.cls}`}>{formatUSD(c.value)}</p>
            </div>
          ))}
        </section>

        {unassigned.length > 0 && (
          <section className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3">
            <h2 className="text-sm font-medium text-warning">
              {unassigned.length} transaction{unassigned.length > 1 ? "s" : ""} without an account
            </h2>
            <p className="text-xs text-warning">
              They count in your monthly totals but not in any account balance. Pick the account and balances update.
            </p>
            <ul className="space-y-1">
              {unassigned.slice(0, 30).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="w-12 shrink-0 text-muted">{t.localDate.slice(5)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.description || (t.category_id ? catName.get(t.category_id) : null) || (t.type === "income" ? "Income" : "Expense")}
                  </span>
                  <span className={t.type === "income" ? "text-success" : ""}>
                    {t.type === "income" ? "+" : "−"}{formatUSD(t.amount)}
                  </span>
                  <TxnAccountSelect id={t.id} accountId={null} accounts={accountOpts} />
                </li>
              ))}
            </ul>
            {unassigned.length > 30 && <p className="text-xs text-warning">Showing the 30 most recent.</p>}
          </section>
        )}

        <div className="grid grid-cols-1 items-start gap-8 @4xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-8">
          <section className="space-y-2">
            <h2 className="section-title">Add a transaction</h2>
            {categories.length === 0 && (
              <form action={addStarterCategories}>
                <button className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 text-sm">
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

          <section className="space-y-2">
            <h2 className="section-title">Recent transactions</h2>
            <ul className="card divide-y divide-line overflow-hidden">
              {txns.slice(0, 40).map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-subtle/60">
                  <span className="w-12 shrink-0 tabular-nums text-muted">{t.localDate.slice(5)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.description || (t.category_id ? catName.get(t.category_id) : null) || (t.type === "income" ? "Income" : "Expense")}
                    <span className="text-xs text-faint">
                      {t.category_id && t.description ? ` · ${catName.get(t.category_id) ?? ""}` : ""}
                    </span>
                  </span>
                  {accounts.length > 0 && <TxnAccountSelect id={t.id} accountId={t.account_id} accounts={accountOpts} />}
                  <span className={`tabular-nums font-medium ${t.type === "income" ? "text-success" : ""}`}>
                    {t.type === "income" ? "+" : "−"}{formatUSD(t.amount)}
                  </span>
                  <form action={deleteTransaction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-xs text-faint hover:text-danger">×</button>
                  </form>
                </li>
              ))}
              {txns.length === 0 && <li className="p-4 text-sm text-faint">No transactions yet.</li>}
            </ul>
          </section>

          {accounts.length >= 2 && (
            <section className="space-y-2">
              <h2 className="section-title">Transfer between accounts</h2>
              <p className="text-xs text-muted">
                Moves money from one account to another. It is not income or expense, so monthly totals and budgets do not change.
                From Telegram: <code>transfer 50 from cash to Pichincha</code>.
              </p>
              <TransferForm today={today} accounts={accountOpts} />
              {transfers.length > 0 && (
                <ul className="card divide-y divide-line overflow-hidden">
                  {transfers.slice(0, 10).map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-12 shrink-0 text-muted">{t.localDate.slice(5)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {accountNameById.get(t.from_account_id) ?? "Removed account"} → {accountNameById.get(t.to_account_id) ?? "Removed account"}
                        {t.note && <span className="text-xs text-faint"> · {t.note}</span>}
                      </span>
                      <span>{formatUSD(t.amount)}</span>
                      <form action={deleteTransfer}>
                        <input type="hidden" name="id" value={t.id} />
                        <button aria-label="Delete transfer" className="text-xs text-faint hover:text-danger">×</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="section-title">Scheduled payments</h2>
            <p className="text-xs text-muted">
              Payments are events on the calendar. Tap Pay on any of them (even before its day) to get the pre-filled transaction;
              on its day it also shows up here and on Today. Recurring ones create their own events.
            </p>
            {due.map((p) => (
              <div key={p.eventId} className="rounded-lg border border-success/30 bg-success-soft p-3">
                <PaymentDraft eventId={p.eventId} title={p.title} date={p.date} template={p.template} expected={p.expected} options={payOptions} today={today} readOnly={mobile} />
              </div>
            ))}
            {templates.length > 0 && (
              <ul className="space-y-2 text-sm">
                {templates.map((t) => {
                  const next = nextUnpaid.get(t.id);
                  return (
                    <li key={t.id} className="space-y-2 rounded-lg bg-subtle p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                        <span>
                          <span className="font-medium">{t.name}</span>{" "}
                          <span className="text-xs text-muted">
                            · {describeRepeat(t.repeat_unit, t.repeat_every)} from {t.start_date}
                            {t.expected_amount ? ` · ${formatUSD(t.expected_amount)}` : ""}
                            {t.type === "income" ? " · income" : ""}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <TemplateAccountSelect templateId={t.id} accountId={t.account_id} accounts={payOptions.accounts} disabled={mobile} />
                          {!mobile && <EditPaymentButton template={t} options={payOptions} today={today} />}
                          {!mobile && <StopPaymentButton id={t.id} name={t.name} />}
                        </span>
                      </div>
                      {next && dueIds.has(next.id) ? (
                        <p className="px-1 text-xs font-medium text-warning">↑ {formatDateLong(next.event_date)}: ready to pay above.</p>
                      ) : next ? (
                        <ul>
                          <PaymentRow
                            eventId={next.id}
                            title={next.title}
                            date={next.event_date}
                            template={t}
                            expected={next.payment_expected_amount}
                            options={payOptions}
                            today={today}
                            readOnly={mobile}
                            prefix="Next:"
                          />
                        </ul>
                      ) : (
                        <p className="px-1 text-xs text-faint">Nothing to pay in the next two months.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {upcoming.filter((e) => !e.payment_template_id || nextUnpaid.get(e.payment_template_id)?.id !== e.id).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">Also coming up (next 31 days)</p>
                <ul className="space-y-1.5">
                  {upcoming
                    .filter((e) => !e.payment_template_id || nextUnpaid.get(e.payment_template_id)?.id !== e.id)
                    .map((e) => (
                      <PaymentRow
                        key={e.id}
                        eventId={e.id}
                        title={e.title}
                        date={e.event_date}
                        template={templates.find((x) => x.id === e.payment_template_id) ?? null}
                        expected={e.payment_expected_amount}
                        options={payOptions}
                        today={today}
                        readOnly={mobile}
                      />
                    ))}
                </ul>
              </div>
            )}
            {recent.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">Recently paid or skipped</p>
                <ul className="space-y-1.5">
                  {recent.map((e) => (
                    <PaymentRow
                      key={e.id}
                      eventId={e.id}
                      title={e.title}
                      date={e.event_date}
                      template={templates.find((x) => x.id === e.payment_template_id) ?? null}
                      expected={e.payment_expected_amount}
                      options={payOptions}
                      today={today}
                      status={e.payment_status}
                      readOnly={mobile}
                    />
                  ))}
                </ul>
              </div>
            )}
            {!mobile && <PaymentForm options={payOptions} date={today} />}
          </section>

          </div>
          <div className="min-w-0 space-y-8">
          <section className="space-y-3">
            <h2 className="section-title">Accounts</h2>
            <ul className="space-y-2">
              {balances.map(({ account, balance, snapshotAt }) => (
                <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 bg-surface shadow-card">
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted">
                      {KIND_LABEL[account.kind] ?? account.kind}
                      {snapshotAt ? ` · balance set ${formatDateLong(utcToLocal(snapshotAt, timezone).date)}` : " · no balance set"}
                    </p>
                  </div>
                  <p className={`text-lg font-semibold tabular-nums ${balance < 0 ? "text-danger" : ""}`}>{formatUSD(balance)}</p>
                  <div className="flex w-full items-center justify-end gap-2">
                    <form action={updateBalance} className="flex items-center gap-1">
                      <input type="hidden" name="account_id" value={account.id} />
                      <input name="amount" inputMode="decimal" placeholder="Real balance" className="w-28 rounded-md border border-line-strong px-2 py-1 text-xs" />
                      <button className="rounded-md border border-edge transition-colors hover:bg-subtle px-2 py-1 text-xs">Update</button>
                    </form>
                    <form action={deleteAccount}>
                      <input type="hidden" name="id" value={account.id} />
                      <button className="text-xs text-faint hover:text-danger">Remove</button>
                    </form>
                  </div>
                </li>
              ))}
              {accounts.length === 0 && <p className="text-sm text-faint">No accounts yet.</p>}
            </ul>
            <AccountForm />
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Budgets</h2>
            <ul className="space-y-2">
              {budgets.map((b) => {
                const u = budgetUsage(b, txns, today);
                const over = u.spent > u.limit;
                return (
                  <li key={b.id} className="space-y-1 rounded-lg border border-line p-3 bg-surface shadow-card">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {catName.get(b.category_id) ?? "Category"}{" "}
                        <span className="text-xs font-normal text-muted">{b.period}</span>
                      </p>
                      <p className={`text-sm ${over ? "text-danger" : "text-muted"}`}>
                        {formatUSD(u.spent)} / {formatUSD(u.limit)} · {over ? `${formatUSD(-u.left)} over` : `${formatUSD(u.left)} left`}
                      </p>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
                      <div
                        className={`h-1.5 rounded-full ${over ? "bg-danger-solid" : u.pct > 80 ? "bg-warning-solid" : "bg-success-solid"}`}
                        style={{ width: `${Math.min(100, u.pct)}%` }}
                      />
                    </div>
                    <form action={deleteBudget} className="text-right">
                      <input type="hidden" name="id" value={b.id} />
                      <button className="text-xs text-faint hover:text-danger">Remove</button>
                    </form>
                  </li>
                );
              })}
              {budgets.length === 0 && <p className="text-sm text-faint">No budgets yet.</p>}
            </ul>
            {expenseCats.length > 0 && <BudgetForm categories={expenseCats.map((c) => ({ id: c.id, name: c.name }))} />}
          </section>

          <section className="space-y-2">
            <h2 className="section-title">{monthName} spending by category</h2>
            <ul className="card space-y-2.5 p-4 text-sm">
              {spendingByCategory(monthTxns).map(([id, amount]) => (
                <li key={id || "none"} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{id ? catName.get(id) ?? "Category" : "Uncategorized"}</span>
                    <span className="tabular-nums text-muted">{formatUSD(amount)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${sums.expense ? Math.round((amount / sums.expense) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
              {sums.expense === 0 && <li className="text-faint">No expenses this month.</li>}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="section-title">Categories</h2>
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-1 rounded-full bg-subtle py-0.5 pl-3 pr-1 text-sm">
                  {c.name}
                  <span className="text-xs text-faint">{c.kind === "income" ? "income" : "expense"}</span>
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={c.id} />
                    <button aria-label={`Delete ${c.name}`} title="Delete category (past transactions become Uncategorized)" className="rounded-full px-1.5 text-faint hover:text-danger">×</button>
                  </form>
                </li>
              ))}
              {categories.length === 0 && <li className="text-sm text-muted">None yet.</li>}
            </ul>
            <CategoryForm />
          </section>

          </div>
        </div>
      </main>
    </>
  );
}
