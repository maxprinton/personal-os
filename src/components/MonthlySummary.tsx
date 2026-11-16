import Link from "next/link";
import { diffText, summaryMonthName, type MonthSummary } from "@/lib/finance-summary";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** BL-28: the monthly summary. compact = the card on /finance (numbers, comparison, top categories). */
export default function MonthlySummary({ s, compact = false }: { s: MonthSummary; compact?: boolean }) {
  const cmp = s.previous ? (s.partial ? "the same days of last month" : summaryMonthName(s.previous.month)) : "";
  const netCls = s.totals.net < 0 ? "text-danger" : s.totals.net > 0 ? "text-success" : "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">
          {summaryMonthName(s.month)}
          {s.partial && <span className="ml-2 text-sm font-normal text-muted">so far · through {s.throughDate.slice(5)}</span>}
        </h2>
        {compact && (
          <Link href={`/finance/summary?m=${s.month}`} className="text-sm text-accent hover:underline">Full summary →</Link>
        )}
      </div>

      {s.totals.count === 0 ? (
        <p className="text-sm text-faint">No income or expenses logged in this month.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3">
              <p className="text-xs text-muted">Income</p>
              <p className="text-lg font-semibold tabular-nums text-success">{usd(s.totals.income)}</p>
              {s.previous && <p className="text-xs text-faint">{diffText(s.totals.income, s.previous.income, cmp)}</p>}
            </div>
            <div className="card p-3">
              <p className="text-xs text-muted">Expenses</p>
              <p className="text-lg font-semibold tabular-nums">{usd(s.totals.expense)}</p>
              {s.previous && <p className="text-xs text-faint">{diffText(s.totals.expense, s.previous.expense, cmp)}</p>}
            </div>
            <div className="card p-3">
              <p className="text-xs text-muted">Net</p>
              <p className={`text-lg font-semibold tabular-nums ${netCls}`}>{s.totals.net < 0 ? "−" : s.totals.net > 0 ? "+" : ""}{usd(Math.abs(s.totals.net))}</p>
              {s.previous && <p className="text-xs text-faint">{diffText(s.totals.net, s.previous.net, cmp)}</p>}
            </div>
          </div>
          {!s.previous && <p className="text-xs text-faint">No earlier month to compare with.</p>}

          {s.categories.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">Where it went</h3>
              <ul className="space-y-1 text-sm">
                {(compact ? s.categories.slice(0, 3) : s.categories).map((c) => (
                  <li key={c.id ?? "none"} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="tabular-nums text-muted">{c.pct}%</span>
                    <span className="w-24 text-right tabular-nums">{usd(c.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!compact && (
            <>
              {s.worth.yes.count + s.worth.no.count > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">Was it worth it?</h3>
                  <p className="text-sm text-muted">
                    ✅ Worth it {usd(s.worth.yes.total)} ({s.worth.yes.count}) · ❌ Not worth it {usd(s.worth.no.total)} ({s.worth.no.count}) · not rated {usd(s.worth.unrated.total)} ({s.worth.unrated.count})
                  </p>
                </div>
              )}
              {s.biggest.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">Biggest transactions</h3>
                  <ul className="space-y-1 text-sm">
                    {s.biggest.map((b) => (
                      <li key={b.id} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 tabular-nums text-muted">{b.date.slice(5)}</span>
                        <span className="min-w-0 flex-1 truncate">{b.label}</span>
                        <span className={`tabular-nums ${b.type === "income" ? "text-success" : ""}`}>{b.type === "income" ? "+" : "−"}{usd(b.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.balances.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">{s.partial ? "Balances now" : "Balances at month end"}</h3>
                  <ul className="space-y-1 text-sm">
                    {s.balances.map((b) => (
                      <li key={b.accountId} className="flex items-center gap-2">
                        <Link href={`/finance/accounts/${b.accountId}`} className="min-w-0 flex-1 truncate hover:text-accent hover:underline">{b.name}</Link>
                        {b.noSnapshot && <span className="text-xs text-faint">no balance set</span>}
                        <span className={`tabular-nums ${b.balance < 0 ? "text-danger" : ""}`}>{usd(b.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-faint">
                Transfers between accounts are not counted as income or expense.
                {s.withoutAccount > 0 && ` ${s.withoutAccount} transaction${s.withoutAccount > 1 ? "s have" : " has"} no account: counted above, not in the balances.`}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
