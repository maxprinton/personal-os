// Budget with buckets on the Finance page (BL-117): settings button and summary on top, the buckets each with their math (envelopes as one line),
// and what the Needs & Wants list can afford next. One screen, top to bottom. Every number has a way to see where it comes from.
// Budget v2 (BL-124): all income counts, savings vs the savings account ("to move"), Spending money after bills,
// the real-money check with Fix, the good-month suggestion, the cushion goal and the debts you owe.
import { setSavingSkip } from "@/app/budget-actions";
import { MISSING_BUDGET, type BudgetState } from "@/lib/budget/data";
import { affordNext, computeBudget, usd, type AffordItem, type BudgetTxn, type EnvelopeInput } from "@/lib/budget/calc";
import { categoriesOf, envelopeCharge, envelopeName, holdsMoney, type BudgetRow, type LimitChange } from "@/lib/budget-rollover";
import BudgetSetup, { type SetupInitial } from "@/components/finance/BudgetSetup";
import { DebtsCard, RealMoneyCheck } from "@/components/finance/BudgetV2Parts";

type Cat = { id: string; name: string };
type Tpl = { name: string; expected: number | null };

const money = (n: number) => (n < 0 ? <span className="text-danger">{usd(n)} over</span> : <span>{usd(n)}</span>);

function TxnList({ rows, catName }: { rows: BudgetTxn[]; catName: Record<string, string> }) {
  if (rows.length === 0) return <p className="px-1 py-2 text-xs text-faint">Nothing here yet.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.slice(0, 60).map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-1 py-1.5">
          <span className="w-12 shrink-0 text-xs text-muted">{t.localDate.slice(5)}</span>
          <span className="min-w-0 flex-1 truncate">{t.description || (t.category_id ? catName[t.category_id] : "") || (t.type === "income" ? "Income" : "Expense")}</span>
          <span className="tabular-nums">{usd(t.amount)}</span>
        </li>
      ))}
      {rows.length > 60 && <li className="px-1 py-1.5 text-xs text-faint">Showing the 60 most recent of {rows.length}.</li>}
    </ul>
  );
}

export default function BudgetSection({
  state,
  today,
  incomeCategories,
  catName,
  petsCategoryId,
  templates,
  purchases,
  envelopes,
  envelopeChanges,
  adjustmentIds = [],
  accountsTotal = null,
  savingsAccount = null,
  billsDue = { total: 0, count: 0 },
  staleAccounts = [],
  accounts = [],
  debtEnvelopeLeft = null,
  debtCategoryExists = false,
}: {
  state: BudgetState;
  today: string;
  incomeCategories: Cat[];
  catName: Record<string, string>;
  petsCategoryId: string | null;
  templates: Tpl[];
  purchases: AffordItem[];
  /** The Envelopes list (migration 0077): what each one takes out of Spending money is worked out here. */
  envelopes: BudgetRow[];
  envelopeChanges: LimitChange[];
  /** BL-124 */
  adjustmentIds?: string[];
  accountsTotal?: number | null;
  savingsAccount?: { id: string; name: string; balance: number } | null;
  billsDue?: { total: number; count: number };
  staleAccounts?: string[];
  accounts?: { id: string; name: string }[];
  debtEnvelopeLeft?: number | null;
  debtCategoryExists?: boolean;
}) {
  if (state.kind === "missing") {
    return (
      <section className="space-y-2">
        <h2 className="section-title">Budget</h2>
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">{MISSING_BUDGET}</p>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="space-y-2">
        <h2 className="section-title">Budget</h2>
        <p className="text-sm text-danger">Could not load the budget: {state.message}</p>
      </section>
    );
  }

  const setupBase = {
    incomeCategories,
    templates,
    hasPets: petsCategoryId !== null,
    accounts,
  };

  if (state.kind === "empty") {
    const initial: SetupInitial = {
      startDate: today,
      percent: "10",
      counted: incomeCategories.filter((c) => /gig|freelance|salary|lv\.?parts|teaching/i.test(c.name)).map((c) => c.id),
      openingSpending: "0",
      openingSavings: "0",
      names: ["Savings", "Fixed costs", "Spending money"],
      savingsAccountId: "",
      planIncome: "0",
      cushionTarget: "0",
    };
    return (
      <section className="space-y-3">
        <h2 className="section-title">Budget</h2>
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-card">
          <p className="text-sm font-medium">Set up your budget</p>
          <p className="text-sm text-muted">A short setup: which income counts, how much to save, and where you start. Five steps, and you can change it any time.</p>
        </div>
        <BudgetSetup initial={initial} hasSettings={false} {...setupBase} />
      </section>
    );
  }

  const { settings: s, txns, skipped, v2, corrections, debts } = state;
  const counted = txns.filter((t) => t.localDate >= s.start_date && t.localDate <= today);
  // Percentage envelopes take their share of the work pay (the income that gets the savings %)
  const ctx = { workPayIds: new Set(s.counted_category_ids), planIncome: v2.planIncome };
  // "Just watch" envelopes hold no money: their payments stay in Fixed costs / spending
  const envInputs: EnvelopeInput[] = envelopes.filter(holdsMoney).map((e) => ({
    id: e.id,
    name: envelopeName(e, (id) => catName[id]),
    categoryIds: categoriesOf(e),
    monthly: e.limit_amount,
    charge: envelopeCharge(e, counted, today, envelopeChanges, s.start_date, ctx),
  }));
  const r = computeBudget({
    settings: s,
    envelopes: envInputs,
    txns,
    skipped: new Set(skipped),
    petsCategoryId,
    today,
    adjustmentIds: new Set(adjustmentIds),
    corrections,
    billsDue: billsDue.total,
    accountsTotal,
    savingsAccountBalance: savingsAccount ? savingsAccount.balance : null,
    planIncome: v2.planIncome,
    cushionTarget: v2.cushionTarget,
  });
  const started = today >= s.start_date;
  const afford = affordNext(purchases, r.spendingMoney);
  const initial: SetupInitial = {
    startDate: s.start_date,
    percent: String(s.savings_percent),
    counted: s.counted_category_ids,
    openingSpending: String(s.opening_spending),
    openingSavings: String(s.opening_savings),
    names: [s.savings_name, s.fixed_name, s.spending_name],
    savingsAccountId: v2.savingsAccountId ?? "",
    planIncome: String(v2.planIncome),
    cushionTarget: String(v2.cushionTarget),
  };

  return (
    <section className="space-y-4">
      <h2 className="section-title">Budget</h2>
      <BudgetSetup initial={initial} hasSettings {...setupBase} />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-fg px-5 py-4 text-app">
          <p className="text-sm opacity-70">{s.spending_name}</p>
          <p className={`font-display text-3xl font-bold tabular-nums tracking-tight ${r.spendingMoney < 0 ? "text-danger" : ""}`}>{r.spendingMoney < 0 ? `${usd(r.spendingMoney)} over` : usd(r.spendingMoney)}</p>
          <p className="text-xs opacity-70">what is left to spend</p>
          {billsDue.count > 0 && (
            <p className="mt-1 text-xs tabular-nums opacity-80">
              {r.afterBills < 0 ? `${usd(r.afterBills)} over` : usd(r.afterBills)} after {billsDue.count} bill{billsDue.count > 1 ? "s" : ""} still due this month ({usd(r.billsDue)})
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-subtle px-5 py-4">
          <p className="text-sm text-muted">{s.savings_name}</p>
          <p className="font-display text-3xl font-bold tabular-nums tracking-tight">{usd(r.savingsTotal)}</p>
          <p className="text-xs text-muted">set aside since {s.start_date}</p>
          {savingsAccount && (
            <p className="mt-1 text-xs tabular-nums text-muted">
              in {savingsAccount.name} {usd(savingsAccount.balance)}
              {r.toMove > 0 && <span className="font-medium text-warning"> · to move {usd(r.toMove)}</span>}
            </p>
          )}
          {r.cushion && (
            <div className="mt-1.5 space-y-0.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
                <div className="h-1.5 rounded-full bg-success-solid" style={{ width: `${r.cushion.pct}%` }} />
              </div>
              <p className="text-xs tabular-nums text-muted">
                {r.cushion.left === 0 ? `Cushion of ${usd(r.cushion.target)} reached ✓` : `${r.cushion.pct}% of the ${usd(r.cushion.target)} cushion · ${usd(r.cushion.left)} to go`}
              </p>
            </div>
          )}
        </div>
      </div>

      {!started && (
        <p className="rounded-lg border border-line bg-subtle p-3 text-sm text-muted">
          This budget starts on {s.start_date}. Until then only the starting money shows. Set your real balances the night before, then put them in Budget settings → Starting money.
        </p>
      )}

      {savingsAccount && r.toMove > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          Move {usd(r.toMove)} to {savingsAccount.name}: your {s.savings_name} is {usd(r.savingsTotal)} on paper, but only {usd(savingsAccount.balance)} is there. Log it as a transfer
          and this line goes away.
        </p>
      )}

      {r.goodMonth && savingsAccount && (
        <p className="rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success">
          You earned {usd(r.goodMonth.extra)} over your {usd(v2.planIncome)} plan this month. Move {usd(r.goodMonth.suggest)} to {savingsAccount.name}? (Only a suggestion: nothing is moved
          for you.)
        </p>
      )}

      {r.gap !== null && r.accountsTotal !== null && started && (
        <RealMoneyCheck
          budgetTotal={r.budgetTotal}
          accountsTotal={r.accountsTotal}
          gap={r.gap}
          stale={staleAccounts}
          spendingName={s.spending_name}
          savingsName={s.savings_name}
          hasCorrections={corrections.length > 0}
        />
      )}

      <div className="space-y-3">
        <div className="space-y-1 rounded-lg border border-line bg-surface p-3 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{s.spending_name}</p>
            <p className="text-sm tabular-nums">{money(r.spendingMoney)}</p>
          </div>
          <p className="text-xs text-muted">What is left of all your income after saving, fixed costs, envelopes and everything else you spent. Balance adjustments count both ways.</p>
          <p className="break-words text-xs tabular-nums">{r.math.spending}</p>
          <details>
            <summary className="cursor-pointer text-xs text-accent">See what you spent</summary>
            <TxnList rows={r.spentRows} catName={catName} />
          </details>
          {r.otherIncomeRows.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-accent">See other income ({usd(r.otherIncome)})</summary>
              <TxnList rows={r.otherIncomeRows} catName={catName} />
            </details>
          )}
          {r.adjRows.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-accent">
                See balance adjustments (+{usd(r.adjIn)} / −{usd(r.adjOut)})
              </summary>
              <TxnList rows={r.adjRows} catName={catName} />
            </details>
          )}
        </div>

        <div className="space-y-1 rounded-lg border border-line bg-surface p-3 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{s.savings_name}</p>
            <p className="text-sm tabular-nums">{usd(r.savingsTotal)}</p>
          </div>
          <p className="text-xs text-muted">{s.savings_percent}% of each work payment (the income categories you picked). Other income is not split. You can skip it on one payment.</p>
          <p className="break-words text-xs tabular-nums">{r.math.savings}</p>
          <details>
            <summary className="cursor-pointer text-xs text-accent">See each payment</summary>
            {r.incomeRows.length === 0 ? (
              <p className="px-1 py-2 text-xs text-faint">No work payments since the start date.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {r.incomeRows.map((row) => (
                  <li key={row.txn.id} className="flex flex-wrap items-center gap-2 px-1 py-1.5">
                    <span className="w-12 shrink-0 text-xs text-muted">{row.txn.localDate.slice(5)}</span>
                    <span className="min-w-0 flex-1 truncate">{row.txn.description || (row.txn.category_id ? catName[row.txn.category_id] : "") || "Income"}</span>
                    <span className="tabular-nums">{usd(row.txn.amount)}</span>
                    <span className={`text-xs ${row.skipped ? "text-warning" : "text-muted"}`}>{row.skipped ? "skipped" : `set aside ${usd(row.part)}`}</span>
                    <form action={setSavingSkip}>
                      <input type="hidden" name="transaction_id" value={row.txn.id} />
                      <input type="hidden" name="skip" value={row.skipped ? "false" : "true"} />
                      <button className="text-xs text-accent hover:underline">{row.skipped ? "Undo skip" : "Skip saving"}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>

        <div className="space-y-1 rounded-lg border border-line bg-surface p-3 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{s.fixed_name}</p>
            <p className="text-sm tabular-nums">{usd(r.fixed)}</p>
          </div>
          <p className="text-xs text-muted">Added up from your subscriptions and recurring payments, and from the Pets category. Nothing to type.</p>
          <p className="break-words text-xs tabular-nums">{r.math.fixed}</p>
          {petsCategoryId === null && <p className="text-xs text-warning">No Pets category yet (migration 0074 creates it). Until then pet payments are counted as spending.</p>}
          <details>
            <summary className="cursor-pointer text-xs text-accent">See these payments</summary>
            <TxnList rows={r.fixedRows} catName={catName} />
          </details>
        </div>

        <div className="space-y-1 rounded-lg border border-line bg-surface p-3 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">Envelopes</p>
            <p className="text-sm tabular-nums">{usd(r.customTotal)}</p>
          </div>
          <p className="text-xs text-muted">
            What your envelopes took out of {s.spending_name} since {s.start_date}: each month&apos;s amount, settled at the end of the month (or kept, with rollover).{" "}
            <a href="#envelopes" className="text-accent hover:underline">Edit envelopes</a>
          </p>
          {r.custom.length === 0 ? (
            <p className="text-xs text-faint">No envelopes yet.</p>
          ) : (
            <p className="break-words text-xs tabular-nums">{r.custom.map((c) => `${c.name} ${usd(c.total)}`).join(" + ")} = {usd(r.customTotal)}</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-accent">See what you spent from envelopes</summary>
            <TxnList rows={r.envelopeRows} catName={catName} />
          </details>
        </div>

        {debts !== null && <DebtsCard debts={debts} accounts={accounts} today={today} hasCategory={debtCategoryExists} envelopeLeft={debtEnvelopeLeft} />}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">What you can afford next</h3>
        {afford.length === 0 ? (
          <p className="text-sm text-faint">Your Needs &amp; Wants list is empty.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden text-sm">
            {afford.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {a.name} <span className="text-xs text-muted">· {a.kind === "need" ? "Needed" : "Wanted"}</span>
                </span>
                <span className="tabular-nums text-muted">{a.price === null ? "no price" : usd(a.price)}</span>
                <span className={`w-28 text-right text-xs ${a.state === "covered" ? "text-success" : a.state === "short" ? "text-warning" : "text-faint"}`}>
                  {a.state === "covered" ? "covered" : a.state === "short" ? `${usd(a.short)} short` : "add a price"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Each item is checked on its own against {s.spending_name}. It never blocks anything.</p>
      </div>

    </section>
  );
}
