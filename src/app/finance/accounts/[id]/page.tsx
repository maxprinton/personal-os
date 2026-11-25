import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getFinance } from "@/lib/finance";
import { accountBalance } from "@/lib/money";
import { buildLedger } from "@/lib/finance-ledger";
import { formatDateLong, localNow, utcToLocal } from "@/lib/time";
import ExportForm from "@/components/finance/ExportForm";
import AccountLedger from "@/components/AccountLedger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account · Personal OS" };

const KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  other: "Other",
};

/** BL-101: everything that touches one account (income, expenses, transfers, balance snapshots). */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const { accounts, categories, snapshots, txns, transfers } = await getFinance(supabase, timezone);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();

  const snaps = snapshots.map((s) => ({ ...s, localDate: utcToLocal(s.recorded_at, timezone).date }));
  const rows = buildLedger(account.id, snaps, txns, transfers);
  const { balance, snapshotAt } = accountBalance(account.id, snapshots, txns, transfers);

  // "Was it worth it?" answers (quietly empty if migration 0050 isn't there)
  const worthRes = await supabase.from("transactions").select("id,worth_it").eq("account_id", account.id).is("deleted_at", null).not("worth_it", "is", null).limit(1000);
  const worthById: Record<string, boolean | null> = {};
  if (!worthRes.error) for (const r of (worthRes.data ?? []) as { id: string; worth_it: boolean }[]) worthById[r.id] = r.worth_it;

  const unassignedCount = accounts.length > 0 ? txns.filter((t) => !t.account_id).length : 0;

  return (
    <main className="@container mx-auto w-full max-w-[1000px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
      <div>
        <Link href="/finance" className="text-sm text-accent hover:underline">← Finance</Link>
        <h1 className="mt-2 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{account.name}</h1>
        <p className="mt-2 text-muted">{KIND_LABEL[account.kind] ?? account.kind}</p>
      </div>
      <section className="space-y-1">
        <p className="text-xs text-muted">Download this account&apos;s movements, transfers and balance changes as CSV. Leave the dates empty for the whole history.</p>
        <ExportForm accountId={account.id} defaultFrom="" defaultTo="" />
      </section>
      <AccountLedger
        accountId={account.id}
        rows={rows}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        today={today}
        header={{
          balance,
          kindLabel: KIND_LABEL[account.kind] ?? account.kind,
          snapshotText: snapshotAt ? `balance set ${formatDateLong(utcToLocal(snapshotAt, timezone).date)}` : "no balance set",
        }}
        worthById={worthById}
        unassignedCount={unassignedCount}
      />
    </main>
  );
}
