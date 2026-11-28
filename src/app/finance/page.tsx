import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getFinance } from "@/lib/finance";
import {
  accountBalance,
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
  deleteTransfer,
  updateBalance,
} from "@/app/finance-actions";
import TxnAccountSelect from "@/components/TxnAccountSelect";
import TransactionList from "@/components/TransactionList";
import CategoryChip from "@/components/CategoryChip";
import { AccountForm, CategoryForm, TransactionForm, TransferForm } from "@/components/FinanceForms";
import { EditPaymentButton, PaymentDraft, PaymentForm, StopPaymentButton, PaymentRow, TemplateAccountSelect } from "@/components/PaymentForms";
import { currentUserId } from "@/lib/calendar/model";
import { getDuePayments, getPaymentTemplates } from "@/lib/calendar/payments";
import { describeRepeat } from "@/lib/calendar/recurrence";
import { addDays } from "@/lib/time";
import { isMobileRequest } from "@/lib/device";
import { listProposals } from "@/lib/category-proposals";
import { loadSummaryData } from "@/lib/finance-summary-data";
import { monthOf, summarizeMonth } from "@/lib/finance-summary";
import MonthlySummary from "@/components/MonthlySummary";
import PurchasesSection from "@/components/finance/PurchasesSection";
import { listPurchases } from "@/lib/purchases/data";
import ExportForm from "@/components/finance/ExportForm";
import CategoryBudgets, { type CategoryBudgetView, type EnvelopeCategory } from "@/components/finance/CategoryBudgets";
import { budgetHistory, budgetStatus, categoriesOf, envelopeName, goalProgress, holdsMoney, type EnvelopeCtx } from "@/lib/budget-rollover";
import { billsDueThisMonth } from "@/lib/budget/calc";
import BudgetSection from "@/components/finance/BudgetSection";
import { loadBudget, type BudgetState } from "@/lib/budget/data";

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
  const { accounts, categories, budgets, budgetChanges, snapshots, txns, transfers } = await getFinance(supabase, timezone);
  const userId = await currentUserId(supabase);
  const mobile = await isMobileRequest();
  const templates = userId ? await getPaymentTemplates(supabase, userId) : [];
  // ✨ Categories chosen by the app, and new ones it proposes (both quietly empty until migration 0026 is run)
  const autoRes = await supabase.from("transactions").select("id").is("deleted_at", null).not("category_id", "is", null).not("auto_category", "is", null).limit(1000);
  const autoIds = autoRes.error ? [] : ((autoRes.data ?? []) as { id: string }[]).map((r) => r.id);
  // "Was it worth it?" answers (quietly empty if migration 0050 isn't there)
  const worthRes = await supabase.from("transactions").select("id,worth_it").is("deleted_at", null).not("worth_it", "is", null).limit(1000);
  const worthOf = new Map<string, boolean>(worthRes.error ? [] : ((worthRes.data ?? []) as { id: string; worth_it: boolean }[]).map((r) => [r.id, r.worth_it]));
  const proposals = userId ? await listProposals(supabase, userId).catch(() => []) : [];
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

  // BL-28: the monthly summary card (a failed read hides the card, never the page)
  const monthSummary = userId ? await loadSummaryData(supabase, userId, timezone).then((d) => summarizeMonth(d, monthOf(today), today)).catch(() => null) : null;

  // BL-116: Needs & Wants (a missing table shows a note in the section, never breaks the page)
  const purchases = userId
    ? await listPurchases(supabase, userId).catch(() => ({ items: [], missing: false, error: "Could not load the list." }))
    : { items: [], missing: false, error: null };

  // BL-117: the budget with buckets (a missing table shows a note in the section, never breaks the page)
  const budgetState: BudgetState = userId
    ? await loadBudget(supabase, userId, timezone).catch((e): BudgetState => ({ kind: "error", message: e instanceof Error ? e.message : "Could not load the budget." }))
    : { kind: "empty" };
  const budgetCatName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  // BL-124: percentage envelopes take their share of the work pay (the income that gets the savings %)
  const envCtx: EnvelopeCtx | undefined =
    budgetState.kind === "ready" ? { workPayIds: new Set(budgetState.settings.counted_category_ids), planIncome: budgetState.v2.planIncome } : undefined;
  // Envelopes: what is available now (with rollover when it is on) and the last 6 months
  const categoryBudgets: CategoryBudgetView[] = budgets.map((b) => {
    const status = budgetStatus(b, txns, today, budgetChanges, envCtx);
    return {
      id: b.id,
      name: envelopeName(b, (id) => budgetCatName[id]),
      typedName: b.name ?? "",
      period: b.period,
      limit: b.limit_amount,
      typedLimit: b.limit_amount,
      rollover: !!b.rollover || (b.percent != null && !!envCtx),
      mode: b.mode === "watch" ? "watch" : "set_aside",
      categoryIds: categoriesOf(b),
      categoryNames: categoriesOf(b).map((id) => budgetCatName[id] ?? "Category"),
      status,
      history: budgetHistory(b, txns, today, budgetChanges, 6, envCtx),
      percent: b.percent ?? null,
      targetAmount: b.target_amount ?? null,
      targetDate: b.target_date ?? null,
      goal: goalProgress(b, status, today),
    };
  });
  const envelopeOf = new Map(budgets.flatMap((b) => categoriesOf(b).map((c) => [c, b.id] as const)));
  const envelopeCats: EnvelopeCategory[] = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({ id: c.id, name: c.name, envelopeId: envelopeOf.get(c.id) ?? null }));
  const petsCategoryId = categories.find((c) => c.kind === "expense" && c.name.trim().toLowerCase() === "pets")?.id ?? null;
  const incomeCategories = categories.filter((c) => c.kind === "income").map((c) => ({ id: c.id, name: c.name }));
  const budgetTemplates = templates.filter((t) => t.type !== "income").map((t) => ({ name: t.name, expected: t.expected_amount ? Number(t.expected_amount) : null }));
  const affordItems = purchases.items
    .filter((i) => i.status === "open")
    .sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === "need" ? -1 : 1))
    .map((i) => ({ id: i.id, name: i.name, price: i.price, kind: i.kind }));

  const month = monthRange(today);
  const monthTxns = txns.filter((t) => inRange(t, month));
  const sums = totals(monthTxns);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const balances = accounts.map((a) => ({ account: a, ...accountBalance(a.id, snapshots, txns, transfers) }));
  const netWorth = balances.reduce((s, b) => s + b.balance, 0);
  // BL-124: the bills still due this month (not held by a set-aside envelope), the savings account, stale balances
  const heldCats = new Set(budgets.filter(holdsMoney).flatMap((b) => categoriesOf(b)));
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const billsDue = billsDueThisMonth(
    payEvents.map((e) => {
      const t = e.payment_template_id ? templateById.get(e.payment_template_id) : undefined;
      return {
        event_date: e.event_date,
        payment_status: e.payment_status,
        payment_expected_amount: e.payment_expected_amount,
        template: t ? { type: t.type, expected_amount: t.expected_amount === null ? null : Number(t.expected_amount), category_id: t.category_id } : null,
      };
    }),
    today,
    heldCats
  );
  const savingsAccountId = budgetState.kind === "ready" ? budgetState.v2.savingsAccountId : null;
  const savingsBal = savingsAccountId ? balances.find((b) => b.account.id === savingsAccountId) : undefined;
  const savingsAccount = savingsBal ? { id: savingsBal.account.id, name: savingsBal.account.name, balance: savingsBal.balance } : null;
  const staleAccounts = balances
    .filter((b) => !b.snapshotAt || utcToLocal(b.snapshotAt, timezone).date < addDays(today, -3))
    .map((b) => b.account.name);
  const adjustmentIds = categories.filter((c) => c.name.trim().toLowerCase() === "adjustment").map((c) => c.id);
  const debtCat = categories.find((c) => c.kind === "expense" && c.name.trim().toLowerCase() === "debt payback");
  const debtEnvelope = debtCat ? categoryBudgets.find((b) => b.mode === "set_aside" && b.categoryIds.includes(debtCat.id)) : undefined;
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name }));
  const unassigned = accounts.length > 0 ? txns.filter((t) => !t.account_id) : [];
  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  // Spending by category as one bar: the 4 biggest in the block palette, the rest together as "Other"
  const palette = ["var(--b-blue)", "var(--b-coral)", "var(--b-magenta)", "var(--b-green)"];
  const spendByCat = expenseCats
    .map((c) => ({
      name: c.name,
      total: monthTxns.filter((t) => t.type === "expense" && t.category_id === c.id).reduce((n, t) => n + t.amount, 0),
    }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const restTotal = spendByCat.slice(4).reduce((n, x) => n + x.total, 0);
  const spendBar = [
    ...spendByCat.slice(0, 4).map((x, i) => ({ ...x, color: palette[i] })),
    ...(restTotal > 0 ? [{ name: "Other", total: restTotal, color: "var(--b-amber)" }] : []),
  ];

  return (
    <>
      <main className="@container mx-auto w-full max-w-[1280px] space-y-8 px-4 py-6 sm:px-8 lg:py-9">
        <div>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Finance</h1>
          <p className="mt-2 text-muted">Log what you can. A balance update fixes the rest.</p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: `${monthName} income`, value: sums.income, cls: "text-success", strong: false },
            { label: `${monthName} spent`, value: sums.expense, cls: "text-danger", strong: false },
            { label: "Net this month", value: sums.net, cls: sums.net >= 0 ? "text-success" : "text-danger", strong: false },
            { label: "All accounts", value: netWorth, cls: "", strong: true },
          ].map((c) => (
            <div key={c.label} className={`rounded-2xl px-5 py-4 ${c.strong ? "bg-fg text-app" : "bg-subtle"}`}>
              <p className={`text-sm ${c.strong ? "opacity-70" : "text-muted"}`}>{c.label}</p>
              <p className={`font-display text-3xl font-bold tabular-nums tracking-tight ${c.cls}`}>{formatUSD(c.value)}</p>
            </div>
          ))}
        </section>

        {monthSummary && (
          <section className="card p-4">
            <MonthlySummary s={monthSummary} compact />
          </section>
        )}

        {spendBar.length > 0 && (
          <section aria-label={`${monthName} spending by category`}>
            <div className="flex h-4 gap-0.5 overflow-hidden rounded-full">
              {spendBar.map((x) => (
                <i key={x.name} className="block" style={{ flex: x.total, background: x.color }} title={`${x.name} ${formatUSD(x.total)}`} />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {spendBar.map((x) => (
                <li key={x.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} aria-hidden />
                  {x.name} <span className="tabular-nums">{formatUSD(x.total)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

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
              showSkip={budgetState.kind === "ready"}
              today={today}
              categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            />
          </section>

          <section className="space-y-2">
            <h2 className="section-title">Transactions</h2>
            <p className="text-xs text-muted">Tap any transaction to change its amount, category, account, date or description.</p>
            <TransactionList
              txns={txns.map((t) => ({
                id: t.id,
                type: t.type,
                amount: t.amount,
                description: t.description,
                category_id: t.category_id,
                account_id: t.account_id,
                localDate: t.localDate,
                worth_it: worthOf.get(t.id) ?? null,
              }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
              accounts={accountOpts}
              today={today}
              autoIds={autoIds}
              proposals={proposals}
            />
          </section>

          <section className="space-y-2">
            <h2 className="section-title">Export</h2>
            <p className="text-xs text-muted">Income, expenses and transfers between accounts as a CSV file, with the balance after each movement.</p>
            <ExportForm accounts={accountOpts} categories={categories.map((c) => ({ id: c.id, name: c.name }))} defaultFrom={month.start} defaultTo={today} />
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
                    <Link href={`/finance/accounts/${account.id}`} className="font-medium hover:text-accent hover:underline" title="Open this account">{account.name}</Link>
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

          <BudgetSection
            state={budgetState}
            today={today}
            incomeCategories={incomeCategories}
            catName={budgetCatName}
            petsCategoryId={petsCategoryId}
            templates={budgetTemplates}
            purchases={affordItems}
            envelopes={budgets}
            envelopeChanges={budgetChanges}
            adjustmentIds={adjustmentIds}
            accountsTotal={netWorth}
            savingsAccount={savingsAccount}
            billsDue={billsDue}
            staleAccounts={staleAccounts}
            accounts={accountOpts}
            debtEnvelopeLeft={debtEnvelope ? debtEnvelope.status.left : null}
            debtCategoryExists={!!debtCat}
          />

          <section className="space-y-3" id="envelopes">
            <div>
              <h2 className="section-title">Envelopes</h2>
              <p className="text-xs text-muted">Set aside: money held each month from Spending money; spending in its categories comes out of it. Just watch: no money held; it only tracks spending against its limit and warns you.</p>
            </div>
            <CategoryBudgets budgets={categoryBudgets} categories={envelopeCats} />
          </section>

          <PurchasesSection
            items={purchases.items}
            missing={purchases.missing}
            error={purchases.error}
            categories={expenseCats.map((c) => ({ id: c.id, name: c.name }))}
            accounts={accountOpts}
            today={today}
          />

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
            <p className="text-xs text-muted">Tap a name to rename it.</p>
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <CategoryChip key={c.id} id={c.id} name={c.name} kind={c.kind} />
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
