// BL-119: "Download CSV" for transactions and transfers. A plain GET form: the browser downloads the file.
type Opt = { id: string; name: string };

const field = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";

export default function ExportForm({
  accounts,
  categories,
  accountId,
  defaultFrom,
  defaultTo,
}: {
  accounts?: Opt[];
  categories?: Opt[];
  /** Set on an account page: that account's own file. */
  accountId?: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  return (
    <form action="/api/export/transactions" method="get" className="flex flex-wrap items-end gap-2">
      {accountId && <input type="hidden" name="account" value={accountId} />}
      <label className="space-y-1 text-xs text-muted">
        From
        <input type="date" name="from" defaultValue={defaultFrom} className={`${field} block`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        To
        <input type="date" name="to" defaultValue={defaultTo} className={`${field} block`} />
      </label>
      {!accountId && accounts && (
        <label className="space-y-1 text-xs text-muted">
          Account
          <select name="account" defaultValue="" className={`${field} block`}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {categories && (
        <label className="space-y-1 text-xs text-muted">
          Category
          <select name="category" defaultValue="" className={`${field} block`}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="space-y-1 text-xs text-muted">
        Type
        <select name="type" defaultValue="all" className={`${field} block`}>
          <option value="all">Everything</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
          <option value="transfer">Transfers</option>
        </select>
      </label>
      <button className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium transition-colors hover:bg-subtle">Download CSV</button>
    </form>
  );
}
