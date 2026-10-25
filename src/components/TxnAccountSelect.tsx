"use client";

import { setTransactionAccount } from "@/app/finance-actions";

/** Dropdown that saves the account of a transaction as soon as it changes. */
export default function TxnAccountSelect({
  id,
  accountId,
  accounts,
}: {
  id: string;
  accountId: string | null;
  accounts: { id: string; name: string }[];
}) {
  return (
    <form action={setTransactionAccount}>
      <input type="hidden" name="id" value={id} />
      <select
        name="account_id"
        defaultValue={accountId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Account"
        className={`max-w-[9rem] rounded-md border px-1.5 py-1 text-xs ${
          accountId ? "border-neutral-200 text-neutral-600" : "border-amber-400 bg-amber-50 text-amber-800"
        }`}
      >
        <option value="">Unassigned</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </form>
  );
}
