"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTransactionAccount } from "@/app/finance-actions";

/** Account dropdown + Save button for an existing transaction. */
export default function TxnAccountSelect({
  id,
  accountId,
  accounts,
}: {
  id: string;
  accountId: string | null;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(accountId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = value !== (accountId ?? "");

  function save() {
    setError(null);
    start(async () => {
      const res = await setTransactionAccount(id, value || null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Account"
        className={`max-w-[9rem] rounded-md border px-1.5 py-1 text-xs ${
          value ? "border-line text-muted" : "border-warning-solid bg-warning-soft text-warning"
        }`}
      >
        <option value="">Unassigned</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      {changed && (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-2 py-1 text-xs text-accent-fg disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
