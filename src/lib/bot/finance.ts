// Money from Telegram (server only): transactions without an account, the real balance of an account,
// budgets (view + alerts at 80 % and 100 %), the latest movements (delete · account · receipt photo).
import { addDays, utcToLocal } from "@/lib/time";
import { accountBalance, budgetUsage, type Budget, type Snapshot, type Transfer, type Txn } from "@/lib/money";
import { claim } from "@/lib/reminders";
import type { Ctx } from "@/lib/bot/core";
import { fetchAll, usd } from "@/lib/bot/core";
import { btn, logAction, pk, undoRow, type Btn, type Kb } from "@/lib/bot/tg";
import { shortDay } from "@/lib/bot/text";

type Reply = { text: string; kb: Kb };
type Account = { id: string; name: string };

export async function accounts(c: Ctx): Promise<Account[]> {
  const { data } = await c.admin.from("accounts").select("id,name").eq("user_id", c.userId).is("deleted_at", null).order("created_at");
  return (data ?? []) as Account[];
}

/** Account buttons, 3 per row. data(accountId | "n") → callback data. */
export function accountRows(list: Account[], data: (acc: string) => string, withNone = true): Kb {
  const rows: Kb = [];
  for (let i = 0; i < list.length; i += 3) rows.push(list.slice(i, i + 3).map((a) => btn(a.name, data(pk(a.id)))));
  if (withNone) rows.push([btn("No account", data("n"))]);
  return rows;
}

type TxnRow = { id: string; type: "income" | "expense"; amount: number; description: string | null; occurred_at: string; account_id: string | null; category_id: string | null; receipt_file_id?: string | null };

const txnLabel = (t: TxnRow, tz: string) =>
  `${t.type === "income" ? "+" : "−"}${usd(Number(t.amount))} ${t.description ?? (t.type === "income" ? "Income" : "Expense")} · ${shortDay(utcToLocal(t.occurred_at, tz).date)}`;

// ---- Without an account -----------------------------------------------------------------

/** /unassigned: one transaction at a time, with your accounts as buttons. */
export async function unassignedView(c: Ctx, offset: number): Promise<Reply> {
  const { data, count } = await c.admin
    .from("transactions")
    .select("id,type,amount,description,occurred_at,account_id,category_id", { count: "exact" })
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .is("account_id", null)
    .order("occurred_at", { ascending: false })
    .range(offset, offset);
  const total = count ?? 0;
  const t = ((data ?? []) as TxnRow[])[0];
  if (!total) return { text: "🏦 Every transaction has an account. ✓", kb: [] };
  if (!t) return offset > 0 ? unassignedView(c, 0) : { text: "🏦 Every transaction has an account. ✓", kb: [] };
  const list = await accounts(c);
  if (!list.length) return { text: "You have no accounts yet. Add them in Personal OS → Finance.", kb: [] };
  const k = pk(t.id);
  const rows = accountRows(list, (a) => `su:${k}:${a}:${offset}`, false);
  rows.push([btn(offset + 1 < total ? "Skip ▸" : "Done", offset + 1 < total ? `sk:${offset + 1}` : `sk:x`)]);
  return {
    text: `🏦 Without an account: ${total}\n\n${offset + 1}/${total} · ${txnLabel(t, c.tz)}\n\nWhich account was it?`,
    kb: rows,
  };
}

export async function setTxnAccount(c: Ctx, txnId: string, accountId: string | null) {
  const list = accountId ? await accounts(c) : [];
  const acc = accountId ? list.find((a) => a.id === accountId) : null;
  if (accountId && !acc) return { ok: false, text: "That account no longer exists." };
  const { data } = await c.admin
    .from("transactions")
    .update({ account_id: acc?.id ?? null })
    .eq("id", txnId)
    .eq("user_id", c.userId)
    .select("id");
  if (!data?.length) return { ok: false, text: "That transaction no longer exists." };
  return { ok: true, text: acc ? `🏦 → ${acc.name}` : "🏦 No account", name: acc?.name ?? "no account" };
}

// ---- Real balance --------------------------------------------------------------------------

async function balances(c: Ctx) {
  const [snapRows, txRows, trRows] = await Promise.all([
    fetchAll<Snapshot>((a, b) => c.admin.from("balance_snapshots").select("id,account_id,amount,recorded_at").eq("user_id", c.userId).is("deleted_at", null).range(a, b)),
    fetchAll<TxnRow>((a, b) => c.admin.from("transactions").select("id,account_id,type,amount,occurred_at,category_id,description").eq("user_id", c.userId).is("deleted_at", null).range(a, b)),
    fetchAll<{ id: string; from_account_id: string; to_account_id: string; amount: number; occurred_at: string }>((a, b) => c.admin.from("transfers").select("id,from_account_id,to_account_id,amount,occurred_at").eq("user_id", c.userId).is("deleted_at", null).range(a, b)),
  ]);
  const snaps = snapRows.map((s) => ({ ...s, amount: Number(s.amount) }));
  const txns: Txn[] = txRows.map((t) => ({ ...t, amount: Number(t.amount), localDate: "" }));
  const trs: Transfer[] = trRows.map((t) => ({ ...t, amount: Number(t.amount), note: null, localDate: "" }));
  return (accountId: string) => accountBalance(accountId, snaps, txns, trs).balance;
}

/** "saldo pichincha 1234.50": shows the difference and asks before saving the real balance. */
export async function askSetBalance(c: Ctx, raw: string, account: Account, amount: number): Promise<Reply> {
  const current = (await balances(c))(account.id);
  const diff = Math.round((amount - current) * 100) / 100;
  const { data: bm } = await c.admin
    .from("bot_messages")
    .insert({ user_id: c.userId, raw_text: raw.slice(0, 4000), status: "parsed", parsed: { kind: "balance_pending", accountId: account.id, amount } })
    .select("id")
    .single();
  if (!bm) return { text: "Sorry, I could not do that.", kb: [] };
  const k = pk(bm.id as string);
  return {
    text: `🏦 ${account.name}\nIn Personal OS: ${usd(current)}\nReal: ${usd(amount)}\nDifference: ${diff === 0 ? "none ✓" : `${diff > 0 ? "+" : "−"}${usd(Math.abs(diff))}`}\n\nSave ${usd(amount)} as the real balance from now on?`,
    kb: [[btn("✓ Save", `bs:${k}:y`), btn("Cancel", `bs:${k}:n`)]],
  };
}

export async function saveBalance(c: Ctx, accountId: string, amount: number): Promise<Reply> {
  const { data, error } = await c.admin
    .from("balance_snapshots")
    .insert({ user_id: c.userId, account_id: accountId, amount })
    .select("id")
    .single();
  if (error || !data) return { text: `Could not save it (${error?.message ?? "unknown error"}).`, kb: [] };
  const { data: acc } = await c.admin.from("accounts").select("name").eq("id", accountId).eq("user_id", c.userId).maybeSingle();
  const logId = await logAction(c.admin, c.userId, "(real balance)", "snapshot", data.id as string);
  return { text: `✓ ${acc?.name ?? "Account"}: real balance ${usd(amount)} saved.`, kb: undoRow(logId) };
}

// ---- Budgets ---------------------------------------------------------------------------------

async function budgetData(c: Ctx) {
  const [{ data: b }, { data: cats }] = await Promise.all([
    c.admin.from("budgets").select("id,category_id,limit_amount,period").eq("user_id", c.userId).is("deleted_at", null),
    c.admin.from("categories").select("id,name").eq("user_id", c.userId),
  ]);
  const budgets = ((b ?? []) as Budget[]).map((x) => ({ ...x, limit_amount: Number(x.limit_amount) }));
  const names = new Map(((cats ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  return { budgets, names };
}

async function periodTxns(c: Ctx, categoryIds: string[]): Promise<Txn[]> {
  if (!categoryIds.length) return [];
  const since = new Date(`${addDays(c.today, -40)}T00:00:00Z`).toISOString();
  const rows = await fetchAll<TxnRow>((a, b) =>
    c.admin
      .from("transactions")
      .select("id,account_id,category_id,type,amount,description,occurred_at")
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .eq("type", "expense")
      .in("category_id", categoryIds)
      .gte("occurred_at", since)
      .range(a, b)
  );
  return rows.map((t) => ({ ...t, amount: Number(t.amount), localDate: utcToLocal(t.occurred_at, c.tz).date }));
}

const bar = (pct: number) => {
  const full = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "▓".repeat(full) + "░".repeat(10 - full);
};

/** /budget: each budget with what's spent, what's left and a bar. */
export async function budgetView(c: Ctx): Promise<Reply> {
  const { budgets, names } = await budgetData(c);
  if (!budgets.length) return { text: "No budgets yet. Set them in Personal OS → Finance.", kb: [] };
  const txns = await periodTxns(c, budgets.map((b) => b.category_id));
  const lines = budgets
    .map((b) => ({ b, u: budgetUsage(b, txns, c.today) }))
    .sort((x, y) => y.u.pct - x.u.pct)
    .map(({ b, u }) => {
      const flag = u.pct >= 100 ? "🔴" : u.pct >= 80 ? "🟠" : "🟢";
      return `${flag} ${names.get(b.category_id) ?? "Category"} (${b.period})\n${bar(u.pct)} ${u.pct}% · ${usd(u.spent)} of ${usd(u.limit)} · ${u.left >= 0 ? `${usd(u.left)} left` : `${usd(-u.left)} over`}`;
    });
  return { text: ["📊 Budgets", "", ...lines].join("\n"), kb: [] };
}

/** After an expense: a warning when its category's budget passes 80 % or 100 % (once per period). */
export async function budgetAlert(c: Ctx, txnId: string): Promise<string | null> {
  const { data: t } = await c.admin
    .from("transactions")
    .select("id,type,amount,category_id,occurred_at")
    .eq("id", txnId)
    .eq("user_id", c.userId)
    .maybeSingle();
  if (!t || t.type !== "expense" || !t.category_id) return null;
  const { budgets, names } = await budgetData(c);
  const mine = budgets.filter((b) => b.category_id === t.category_id);
  if (!mine.length) return null;
  const txns = await periodTxns(c, [t.category_id as string]);
  const out: string[] = [];
  for (const b of mine) {
    const u = budgetUsage(b, txns, c.today);
    const localDate = utcToLocal(t.occurred_at as string, c.tz).date;
    const inPeriod = localDate >= u.range.start && localDate < u.range.end;
    if (!inPeriod) continue;
    const before = b.limit_amount > 0 ? Math.round(((u.spent - Number(t.amount)) / b.limit_amount) * 100) : 0;
    const th = u.pct >= 100 && before < 100 ? 100 : u.pct >= 80 && before < 80 ? 80 : null;
    if (!th) continue;
    if (!(await claim(c.admin, c.userId, "budget", `${b.id}:${u.range.start}:${th}`))) continue;
    const name = names.get(b.category_id) ?? "Category";
    out.push(
      th === 100
        ? `🔴 ${name}: budget passed — ${usd(u.spent)} of ${usd(u.limit)} this ${b.period === "weekly" ? "week" : "month"} (${u.pct}%).`
        : `🟠 ${name}: ${u.pct}% of the budget used — ${usd(u.left)} left this ${b.period === "weekly" ? "week" : "month"}.`
    );
  }
  return out.length ? out.join("\n") : null;
}

// ---- Latest movements ----------------------------------------------------------------------

export function txnRow(t: Pick<TxnRow, "id" | "type" | "amount" | "description" | "receipt_file_id">): Btn[] {
  const k = pk(t.id);
  const row = [
    btn(`🗑 ${t.type === "income" ? "+" : "−"}${usd(Number(t.amount))} ${t.description ?? ""}`.trim(), `md:${k}`),
    btn("🏦", `ma:${k}`),
  ];
  if (t.receipt_file_id) row.push(btn("🧾", `rp:${k}`));
  return row;
}

async function latestTxns(c: Ctx, limit: number) {
  // receipt_file_id needs migration 0019; without it the list still works
  const cols = "id,type,amount,description,occurred_at,account_id,category_id";
  const first = await c.admin
    .from("transactions")
    .select(`${cols},receipt_file_id`)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (!first.error) return (first.data ?? []) as TxnRow[];
  const second = await c.admin.from("transactions").select(cols).eq("user_id", c.userId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(limit);
  return (second.data ?? []) as TxnRow[];
}

/** /movements: the last 10 transactions and transfers, with 🗑 · 🏦 · 🧾. */
export async function movementsView(c: Ctx): Promise<Reply> {
  const [txns, { data: trs }, list] = await Promise.all([
    latestTxns(c, 10),
    c.admin
      .from("transfers")
      .select("id,from_account_id,to_account_id,amount,occurred_at")
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(5),
    accounts(c),
  ]);
  const name = new Map(list.map((a) => [a.id, a.name]));
  type Tr = { id: string; from_account_id: string; to_account_id: string; amount: number; occurred_at: string };
  const items = [
    ...txns.map((t) => ({ at: t.occurred_at, t, tr: null as Tr | null })),
    ...((trs ?? []) as Tr[]).map((tr) => ({ at: tr.occurred_at, t: null as TxnRow | null, tr })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 10);
  if (!items.length) return { text: "No movements yet.", kb: [] };
  const lines: string[] = ["🧾 Latest movements", ""];
  const kb: Kb = [];
  for (const it of items) {
    if (it.t) {
      lines.push(`• ${txnLabel(it.t, c.tz)} · ${it.t.account_id ? name.get(it.t.account_id) ?? "?" : "no account"}${it.t.receipt_file_id ? " · 🧾" : ""}`);
      kb.push(txnRow(it.t));
    } else if (it.tr) {
      const label = `${usd(Number(it.tr.amount))} ${name.get(it.tr.from_account_id) ?? "?"} → ${name.get(it.tr.to_account_id) ?? "?"}`;
      lines.push(`• ⇄ ${label} · ${shortDay(utcToLocal(it.tr.occurred_at, c.tz).date)}`);
      kb.push([btn(`🗑 ⇄ ${label}`, `mt:${pk(it.tr.id)}`)]);
    }
  }
  lines.push("", "🗑 delete (with undo) · 🏦 change the account · 🧾 see the receipt");
  return { text: lines.join("\n"), kb };
}

export async function getTxn(c: Ctx, id: string) {
  const { data } = await c.admin
    .from("transactions")
    .select("id,type,amount,description,occurred_at,account_id,category_id,event_id,deleted_at")
    .eq("id", id)
    .eq("user_id", c.userId)
    .maybeSingle();
  return data as (TxnRow & { event_id: string | null; deleted_at: string | null }) | null;
}

/** Deletes a transaction (a confirmed payment goes back to "due", like the web). */
export async function deleteTxn(c: Ctx, id: string) {
  await c.admin.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("user_id", c.userId);
  await c.admin.from("events").update({ payment_status: null, payment_transaction_id: null }).eq("user_id", c.userId).eq("payment_transaction_id", id);
}

export async function restoreTxn(c: Ctx, id: string) {
  const t = await getTxn(c, id);
  if (!t) return;
  await c.admin.from("transactions").update({ deleted_at: null }).eq("id", id).eq("user_id", c.userId);
  if (t.event_id) {
    await c.admin.from("events").update({ payment_status: "paid", payment_transaction_id: id }).eq("id", t.event_id).eq("user_id", c.userId).is("payment_status", null);
  }
}

// ---- Receipts (Telegram keeps the photo; migration 0019) ---------------------------------------

export async function setReceipt(c: Ctx, txnId: string, fileId: string) {
  await c.admin.from("transactions").update({ receipt_file_id: fileId }).eq("id", txnId).eq("user_id", c.userId);
}

export async function receiptOf(c: Ctx, txnId: string): Promise<string | null> {
  const { data, error } = await c.admin.from("transactions").select("receipt_file_id").eq("id", txnId).eq("user_id", c.userId).maybeSingle();
  if (error) return null;
  return (data?.receipt_file_id as string | null | undefined) ?? null;
}

export { txnLabel };
