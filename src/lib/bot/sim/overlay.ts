// A copy-on-write layer over the real Supabase client, for the Telegram simulator (server only).
//   • READS go to the real database (your real tasks, balances, notes…), then the practice changes are merged in.
//   • WRITES (insert / update / delete / upsert / storage and every rpc that writes) never reach the database: they are kept in `db`
//     (a plain JSON object the page sends back and forth), so “Saved ✓ → Undo”, “reply to correct” and “✓ done →
//     /tasks no longer shows it” behave like the real bot — but nothing real changes.
// db.rows[table] = rows created or changed in practice (changed rows are full copies, matched by id)
// db.gone[table] = ids of real rows deleted in practice
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DEFAULTS } from "@/lib/bot/sim/defaults";

export type Row = Record<string, unknown>;
export type SimDb = { rows: Record<string, Row[]>; gone: Record<string, string[]> };
export const emptyDb = (): SimDb => ({ rows: {}, gone: {} });

type Op = { m: string; a: unknown[] };
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number };

const FILTERS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "is", "in", "not", "ilike", "like", "or", "match", "filter", "contains", "overlaps", "textSearch"]);
const IGNORED = new Set(["abortSignal", "returns", "throwOnError", "csv", "explain"]);
const PAGE = 1000;
const MAX_REAL_ROWS = 20_000;

// ---- Evaluating a filter on a practice row (the real rows are filtered by the database) -----------------

const str = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function cmp(a: unknown, b: unknown): number {
  const na = Number(a), nb = Number(b);
  if (typeof a !== "boolean" && typeof b !== "boolean" && str(a).trim() !== "" && str(b).trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const x = str(a), y = str(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
const like = (value: unknown, pattern: string, ci: boolean) =>
  value !== null && value !== undefined && new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, ci ? "is" : "s").test(str(value));
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")));

/** One condition: column op value. Unknown operators pass (a practice row is never hidden by something we can't read). */
function test(row: Row, col: string, op: string, val: unknown): boolean {
  const a = row[col] ?? null;
  switch (op) {
    case "eq": return a !== null && str(a) === str(val);
    case "neq": return a !== null && str(a) !== str(val);
    case "gt": return a !== null && cmp(a, val) > 0;
    case "gte": return a !== null && cmp(a, val) >= 0;
    case "lt": return a !== null && cmp(a, val) < 0;
    case "lte": return a !== null && cmp(a, val) <= 0;
    case "is": return val === null || val === "null" ? a === null : a === (val === "true" ? true : val === "false" ? false : val);
    case "in": return listOf(val).some((x) => str(x) === str(a));
    case "like": return like(a, String(val), false);
    case "ilike": return like(a, String(val), true);
    default: return true;
  }
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function matches(row: Row, filters: Op[]): boolean {
  return filters.every(({ m, a }) => {
    switch (m) {
      case "not": return !test(row, String(a[0]), String(a[1]), a[2]);
      case "or":
        return splitTop(String(a[0])).some((part) => {
          const [col, op, ...rest] = part.split(".");
          return test(row, col, op, rest.join("."));
        });
      case "match": return Object.entries(a[0] as Row).every(([k, v]) => test(row, k, "eq", v));
      case "filter": return test(row, String(a[0]), String(a[1]), a[2]);
      case "contains": case "overlaps": case "textSearch": return true;
      default: return test(row, String(a[0]), m, a[1]);
    }
  });
}

const project = (row: Row, cols: string): Row => {
  if (cols.trim() === "*" || cols.trim() === "") return { ...row };
  const out: Row = {};
  for (const c of splitTop(cols)) {
    const name = c.trim();
    if (!name || name.includes("(")) continue;
    const [alias, real] = name.includes(":") ? name.split(":") : [name, name];
    out[alias.trim()] = row[real.trim()] ?? null;
  }
  return out;
};

function fill(table: string, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(DEFAULTS[table] ?? {})) {
    out[k] = v === "$now" ? new Date().toISOString() : v === "$today" ? new Date().toISOString().slice(0, 10) : v === "$uuid" ? randomUUID() : v;
  }
  const merged = { ...out, ...row };
  if (merged.id === undefined || merged.id === null) merged.id = randomUUID();
  if (merged.created_at === undefined) merged.created_at = new Date().toISOString();
  return merged;
}

// ---- The query builder ----------------------------------------------------------------------------------

function builder(real: SupabaseClient, db: SimDb, table: string): unknown {
  const ops: Op[] = [];
  let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: unknown;
  let cols = "*";
  let selOpts: { count?: string; head?: boolean } | undefined;
  let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;
  let wantRows = false;
  let one: "single" | "maybe" | null = null;

  const filters = () => ops.filter((o) => FILTERS.has(o.m));
  const ordersOf = () => ops.filter((o) => o.m === "order");
  const ids = (rows: Row[]) => new Set(rows.map((r) => str(r.id)));

  // The same query on the real client (all filters; optionally order / limit / range too)
  const mk = (select: string, withTail: boolean, opts?: { count?: string; head?: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = real.from(table).select(select, opts as never);
    for (const o of ops) {
      if (FILTERS.has(o.m) || (withTail && ["order", "limit", "range"].includes(o.m))) q = q[o.m](...o.a);
    }
    return q;
  };

  /** All real rows that match the filters (full rows, paged). */
  async function realRows(select = "*"): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; from < MAX_REAL_ROWS; from += PAGE) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = (await mk(select, false).range(from, from + PAGE - 1)) as any;
      if (error) throw new Error(error.message);
      out.push(...((data as Row[]) ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  /** Real rows (minus deleted / changed ones) + practice rows that match. */
  async function merged(select = "*"): Promise<Row[]> {
    const mine = db.rows[table] ?? [];
    const gone = new Set(db.gone[table] ?? []);
    const withId = select === "*" || /(^|,)\s*id\s*(,|$)/.test(select) || select.includes("(") ? select : `${select},id`;
    let base: Row[];
    try {
      base = await realRows(withId);
    } catch {
      base = await realRows(select); // a table without an id column
    }
    const mineIds = ids(mine);
    const keep = base.filter((r) => r.id === undefined || (!mineIds.has(str(r.id)) && !gone.has(str(r.id))));
    return [...keep, ...mine.filter((r) => matches(r, filters())).map((r) => ({ ...r }))];
  }

  const sortRows = (rows: Row[]) => {
    for (const o of [...ordersOf()].reverse()) {
      const col = String(o.a[0]);
      const asc = (o.a[1] as { ascending?: boolean } | undefined)?.ascending !== false;
      rows.sort((x, y) => {
        const a = x[col] ?? null, b = y[col] ?? null;
        if (a === null && b === null) return 0;
        if (a === null) return asc ? 1 : -1; // nulls last when ascending
        if (b === null) return asc ? -1 : 1;
        return cmp(a, b) * (asc ? 1 : -1);
      });
    }
    return rows;
  };

  const respond = (rows: Row[], count?: number): Result => {
    if (one) {
      if (rows.length === 1 || (one === "maybe" && rows.length <= 1)) return { data: rows[0] ?? null, error: null };
      if (one === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: rows, error: null, ...(count !== undefined ? { count } : {}) };
  };

  const store = (row: Row) => {
    const list = (db.rows[table] ??= []);
    const i = list.findIndex((r) => str(r.id) === str(row.id));
    if (i >= 0) list[i] = row; else list.push(row);
  };

  async function run(): Promise<Result> {
    try {
      if (mode === "select") {
        const mine = db.rows[table] ?? [];
        const gone = db.gone[table] ?? [];
        if (!mine.length && !gone.length) {
          // Nothing practiced on this table: exactly the real query
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q: any = mk(cols, true, selOpts);
          if (one === "single") q = q.single();
          else if (one === "maybe") q = q.maybeSingle();
          return (await q) as Result;
        }
        let rows = sortRows(await merged(cols));
        const total = rows.length;
        const range = ops.find((o) => o.m === "range");
        const limit = ops.find((o) => o.m === "limit");
        if (range) rows = rows.slice(Number(range.a[0]), Number(range.a[1]) + 1);
        if (limit) rows = rows.slice(0, Number(limit.a[0]));
        const shown = rows.map((r) => project(r, cols));
        if (selOpts?.head) return { data: null, error: null, count: total };
        return respond(shown, selOpts?.count ? total : undefined);
      }

      if (mode === "insert") {
        const made = (Array.isArray(payload) ? payload : [payload]).map((r) => fill(table, r as Row));
        for (const r of made) store(r);
        return wantRows ? respond(made.map((r) => project(r, cols))) : { data: null, error: null };
      }

      if (mode === "upsert") {
        const conflict = (upsertOpts?.onConflict ?? "id").split(",").map((s) => s.trim());
        const made: Row[] = [];
        for (const r of (Array.isArray(payload) ? payload : [payload]) as Row[]) {
          const mine = (db.rows[table] ?? []).find((x) => conflict.every((c) => r[c] !== undefined && str(x[c]) === str(r[c])));
          let found: Row | undefined = mine;
          if (!found && conflict.every((c) => r[c] !== undefined)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let q: any = real.from(table).select("*");
            for (const c of conflict) q = q.eq(c, r[c]);
            const { data } = (await q.limit(1)) as { data: Row[] | null };
            found = data?.[0];
            if (found && (db.gone[table] ?? []).includes(str(found.id))) found = undefined;
          }
          if (found && upsertOpts?.ignoreDuplicates) continue;
          const row = found ? { ...found, ...r, updated_at: new Date().toISOString() } : fill(table, r);
          store(row);
          made.push(row);
        }
        return wantRows ? respond(made.map((r) => project(r, cols))) : { data: null, error: null };
      }

      // update / delete: the rows the filters pick, as they are now (real ones not yet changed, plus practice rows)
      const mine = db.rows[table] ?? [];
      const mineIds = ids(mine);
      const gone = new Set(db.gone[table] ?? []);
      const fromReal = (await realRows("*")).filter((r) => r.id !== undefined && !mineIds.has(str(r.id)) && !gone.has(str(r.id)));
      const targets = [...fromReal, ...mine.filter((r) => matches(r, filters()))];

      if (mode === "update") {
        const patch = payload as Row;
        const done = targets.map((r) => ({ ...r, ...patch, updated_at: new Date().toISOString() }));
        for (const r of done) store(r);
        return wantRows ? respond(done.map((r) => project(r, cols))) : { data: null, error: null };
      }

      // delete
      const del = new Set(targets.map((r) => str(r.id)));
      db.rows[table] = mine.filter((r) => !del.has(str(r.id)));
      db.gone[table] = [...gone, ...fromReal.map((r) => str(r.id)), ...mine.filter((r) => del.has(str(r.id))).map((r) => str(r.id))].filter((v, i, all) => all.indexOf(v) === i);
      return wantRows ? respond(targets.map((r) => project(r, cols))) : { data: null, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "practice query failed" } };
    }
  }

  const api: Record<string, unknown> = {};
  for (const f of FILTERS) api[f] = (...a: unknown[]) => (ops.push({ m: f, a }), api);
  for (const f of ["order", "limit", "range"]) api[f] = (...a: unknown[]) => (ops.push({ m: f, a }), api);
  for (const f of IGNORED) api[f] = () => api;
  api.select = (c = "*", o?: { count?: string; head?: boolean }) => {
    cols = c;
    if (mode === "select") selOpts = o; else wantRows = true;
    return api;
  };
  api.insert = (rows: unknown) => ((mode = "insert"), (payload = rows), api);
  api.update = (patch: unknown) => ((mode = "update"), (payload = patch), api);
  api.upsert = (rows: unknown, o?: { onConflict?: string; ignoreDuplicates?: boolean }) => ((mode = "upsert"), (payload = rows), (upsertOpts = o), api);
  api.delete = () => ((mode = "delete"), api);
  api.single = () => ((one = "single"), api);
  api.maybeSingle = () => ((one = "maybe"), api);
  api.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej);
  return api;
}

const nothing = async () => ({ data: null, error: { message: "Not available in practice mode." } });

// Functions that only READ: they run for real (so /search, typo suggestions and usage totals behave like Telegram).
// Every other function writes something (refresh_daily_facts, generate_insights, rollover…) and stays a no-op.
const READ_RPC = new Set(["search_notes", "search_suggest", "search_passages", "ai_usage_summary"]);

const plain = (v: unknown) => str(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The real search over your notes, plus the notes you created or changed while practicing. */
function mergeSearch(res: Result, args: Record<string, unknown>, db: SimDb): Result {
  if (res.error) return res;
  const trash = Boolean(args.p_trash), templates = Boolean(args.p_templates);
  const mine = db.rows.notes ?? [];
  const mineBy = new Map(mine.map((n) => [str(n.id), n]));
  const gone = new Set(db.gone.notes ?? []);
  const rows = ((res.data as Row[] | null) ?? []).filter((r) => {
    const id = str(r.note_id);
    if (gone.has(id)) return false;
    const p = mineBy.get(id);
    return !(p && p.deleted_at && !trash);
  });
  const words = (t: unknown) => plain(t).match(/[a-z0-9]+/g) ?? [];
  const terms = ((args.p_terms as string[] | null) ?? []).map(words);
  const nots = ((args.p_not as string[] | null) ?? []).map(words);
  const has = (hay: string, ws: string[]) => ws.every((w) => new RegExp(`(^|[^a-z0-9])${w}`).test(hay));
  const have = new Set(rows.map((r) => str(r.note_id)));
  for (const n of mine) {
    const id = str(n.id);
    if (have.has(id) || n.merged_into) continue;
    if (n.deleted_at && !trash) continue;
    if (n.is_template && !templates) continue;
    const text = [n.title, n.block_name, typeof n.content === "string" ? n.content : JSON.stringify(n.content ?? "")].map(plain).join(" \n ");
    if (!terms.length || !terms.every((ws) => ws.length && has(text, ws)) || nots.some((ws) => ws.length && has(text, ws))) continue;
    const body = String(n.title ?? "").trim() || String(n.block_name ?? "") || "Untitled";
    rows.unshift({ note_id: id, score: 1, total: 0, hits: { pieces: 1, top: [{ kind: "title", label: null, anchor: null, file: null, body }] } });
  }
  const limit = Number(args.p_limit) || 20;
  const out = rows.slice(0, limit).map((r) => ({ ...r, total: rows.length }));
  return { ...res, data: out };
}

/** The client the bot gets in practice mode. */
export function simClient(real: SupabaseClient, db: SimDb): SupabaseClient {
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    const done: Promise<Result> = READ_RPC.has(name)
      ? (async () => {
          try {
            const r = (await real.rpc(name, args as never)) as unknown as Result;
            return name === "search_notes" ? mergeSearch(r, args, db) : r;
          } catch (e) {
            return { data: null, error: { message: e instanceof Error ? e.message : "practice query failed" } };
          }
        })()
      : Promise.resolve({ data: null, error: null });
    return Object.assign(done, { single: () => done, maybeSingle: () => done });
  };
  const storage = { from: () => ({ upload: nothing, download: nothing, remove: nothing, list: nothing, createSignedUrl: nothing, getPublicUrl: () => ({ data: { publicUrl: "" } }) }) };
  return { from: (table: string) => builder(real, db, table), rpc, storage, auth: { admin: {} }, functions: { invoke: nothing } } as unknown as SupabaseClient;
}
