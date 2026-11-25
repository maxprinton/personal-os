// BL-119: the CSV download of transactions and transfers (all accounts, or one). Signed-in only.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { utcToLocal } from "@/lib/time";
import { buildExportRows, exportCsv, parseExportQuery } from "@/lib/finance-export";
import type { SnapshotWithDate } from "@/lib/finance-ledger";
import type { Transfer, Txn } from "@/lib/money";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAGE = 1000;
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "account";

export async function GET(req: NextRequest) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const q = parseExportQuery(req.nextUrl.searchParams);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });
  const { timezone } = await getSettings(sb);

  // Every row, not just the first 1000 the database returns by default
  async function all<T>(table: string, cols: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(cols).eq("user_id", user!.id).is("deleted_at", null).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  try {
    const [acc, cat, snap, tx, tr] = await Promise.all([
      sb.from("accounts").select("id,name").eq("user_id", user.id).is("deleted_at", null),
      sb.from("categories").select("id,name").eq("user_id", user.id).is("deleted_at", null),
      all<{ id: string; account_id: string; amount: number | string; recorded_at: string }>("balance_snapshots", "id,account_id,amount,recorded_at"),
      all<Omit<Txn, "localDate">>("transactions", "id,account_id,category_id,type,amount,description,occurred_at"),
      all<Omit<Transfer, "localDate">>("transfers", "id,from_account_id,to_account_id,amount,note,occurred_at"),
    ]);
    if (acc.error || cat.error) throw new Error((acc.error ?? cat.error)!.message);
    const accounts = (acc.data ?? []) as { id: string; name: string }[];
    if (q.accountId && !accounts.some((a) => a.id === q.accountId)) return NextResponse.json({ error: "That account does not exist." }, { status: 404 });

    const snapshots: SnapshotWithDate[] = snap.map((s) => ({ ...s, amount: Number(s.amount), localDate: utcToLocal(s.recorded_at, timezone).date }));
    const txns: Txn[] = tx.map((t) => ({ ...t, amount: Number(t.amount), localDate: utcToLocal(t.occurred_at, timezone).date }));
    const transfers: Transfer[] = tr.map((t) => ({ ...t, amount: Number(t.amount), localDate: utcToLocal(t.occurred_at, timezone).date }));

    const rows = buildExportRows({ accounts, categories: (cat.data ?? []) as { id: string; name: string }[], snapshots, txns, transfers, ...q });
    const name = `transactions-${q.accountId ? slug(accounts.find((a) => a.id === q.accountId)!.name) : "all-accounts"}${q.from ? `-from-${q.from}` : ""}${q.to ? `-to-${q.to}` : ""}.csv`;
    return new NextResponse(exportCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not make the file." }, { status: 500 });
  }
}
