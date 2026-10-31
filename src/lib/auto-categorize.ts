// Auto-categorize (server only): one "round" reads the uncategorized transactions, applies what the user's own
// habits already say (free), asks the AI about each remaining merchant ONCE, applies the confident answers, turns
// "no category fits" into PROPOSALS (nothing is created until the user approves) and leaves the truly unclear ones
// uncategorized. Works with the signed-in client (RLS) and the admin client (Telegram / cron): every query filters
// by user_id. The database and the AI are passed in, so the logic can be tested without either.
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { withAiUsage } from "@/lib/ai-usage";
import { ADJUSTMENT_CATEGORY, ADJUSTMENT_DESCRIPTION } from "@/lib/balance-adjust";
import {
  SYSTEM,
  buildHistory,
  buildPrompt,
  decide,
  groupTransactions,
  historyExamples,
  historyPick,
  parseAnswer,
  proposalKey,
  type Cat,
  type HistoryRow,
  type Kind,
  type Tx,
} from "@/lib/auto-categorize-core";

export type ProposalRow = { id: string; name: string; kind: Kind; tx_ids: string[]; created_at?: string };

export interface Db {
  categories(): Promise<Cat[]>;
  uncategorized(): Promise<Tx[]>;
  history(): Promise<{ rows: HistoryRow[]; markers: boolean }>;
  /** null = the proposals table doesn't exist yet (migration 0026 not run). */
  pendingProposals(): Promise<ProposalRow[] | null>;
  declined(): Promise<string[]>;
  saveProposal(kind: Kind, name: string, ids: string[]): Promise<boolean>;
  /** Sets the category on those still-uncategorized transactions; returns the ids really updated. */
  apply(categoryId: string, ids: string[], by: "ai" | "history"): Promise<string[]>;
}
export type Ask = (system: string, prompt: string) => Promise<{ text: string } | { error: string }>;

export const aiAsk: Ask = (system, prompt) =>
  aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0, maxTokens: 2500, timeoutMs: 40_000 });

export type RoundResult = {
  /** Transactions looked at in this round (history + the groups sent to the AI). */
  checked: number;
  categorized: number;
  byHistory: number;
  byAi: number;
  proposed: { name: string; kind: Kind; count: number }[];
  /** Tried and left uncategorized (too unclear). The caller passes them back as `skip`. */
  unsure: string[];
  /** Transactions still not tried (more merchants than one round handles). */
  left: number;
  applied: { id: string; categoryId: string }[];
  aiOff?: boolean;
  proposalsOff?: boolean;
  /** false = migration 0026 missing: no ✨ marks. */
  markers: boolean;
  error?: string;
};

const MAX_GROUPS = 30;
const MAX_NEW_CATEGORIES = 5;

export async function runRound(db: Db, opts: { skip?: string[]; maxGroups?: number; ask?: Ask | null } = {}): Promise<RoundResult> {
  const out: RoundResult = { checked: 0, categorized: 0, byHistory: 0, byAi: 0, proposed: [], unsure: [], left: 0, applied: [], markers: true };
  const skip = new Set(opts.skip ?? []);
  const cats = (await db.categories()).filter((c) => c.name.toLowerCase() !== ADJUSTMENT_CATEGORY.toLowerCase());
  const pending = await db.pendingProposals();
  out.proposalsOff = pending === null;
  const waiting = new Set((pending ?? []).flatMap((p) => p.tx_ids));
  const pool = (await db.uncategorized()).filter((t) => !skip.has(t.id) && !waiting.has(t.id) && t.description !== ADJUSTMENT_DESCRIPTION);
  if (!pool.length) return out;

  // 1) The person's own habits: "Supermaxi" was always Food → Food, no AI needed
  const hist = await db.history();
  out.markers = hist.markers;
  const h = buildHistory(hist.rows, cats);
  const byCat = new Map<string, string[]>();
  const rest: Tx[] = [];
  for (const t of pool) {
    const id = historyPick(h, t.type, t.description);
    if (id) byCat.set(id, [...(byCat.get(id) ?? []), t.id]);
    else rest.push(t);
  }
  for (const [categoryId, ids] of byCat) {
    for (const done of await db.apply(categoryId, ids, "history")) {
      out.applied.push({ id: done, categoryId });
      out.byHistory++;
    }
  }
  out.checked += pool.length - rest.length;

  // 2) The AI, one question per merchant
  const { groups, blank } = groupTransactions(rest);
  out.unsure.push(...blank.map((t) => t.id)); // no text at all: nothing to read
  out.checked += blank.length;
  const take = groups.slice(0, opts.maxGroups ?? MAX_GROUPS);
  out.left = groups.slice(take.length).reduce((n, g) => n + g.ids.length, 0);
  if (!take.length) return finish(out);
  if (opts.ask === null || (opts.ask === undefined && !hasAi())) {
    out.aiOff = true;
    out.left = 0;
    out.unsure.push(...take.flatMap((g) => g.ids));
    return finish(out);
  }
  const ask = opts.ask ?? aiAsk;
  const declined = new Set(await db.declined());
  const prompt = buildPrompt(
    cats,
    take,
    historyExamples(h),
    (pending ?? []).map((p) => `${p.name} (${p.kind})`),
    [...declined].map((k) => k.replace("|", " ")),
  );
  const answer = await ask(SYSTEM, prompt);
  if (!("text" in answer)) {
    out.error = answer.error;
    out.left += take.reduce((n, g) => n + g.ids.length, 0); // not tried: they stay in the queue
    return finish(out);
  }
  const guesses = parseAnswer(answer.text);
  const aiBy = new Map<string, string[]>();
  const proposals = new Map<string, { kind: Kind; name: string; ids: string[] }>();
  for (const g of take) {
    out.checked += g.ids.length;
    const d = decide(guesses.get(g.n), g.type, cats, declined);
    if (d.kind === "category") aiBy.set(d.cat.id, [...(aiBy.get(d.cat.id) ?? []), ...g.ids]);
    else if (d.kind === "proposal") {
      const k = proposalKey(g.type, d.name);
      const p = proposals.get(k) ?? { kind: g.type, name: d.name, ids: [] };
      p.ids.push(...g.ids);
      proposals.set(k, p);
    } else out.unsure.push(...g.ids);
  }
  for (const [categoryId, ids] of aiBy) {
    // (a transaction the user edited meanwhile is not touched: apply() only fills empty categories)
    for (const id of await db.apply(categoryId, ids, "ai")) {
      out.applied.push({ id, categoryId });
      out.byAi++;
    }
  }
  // 3) New categories are only proposed
  let made = 0;
  for (const p of [...proposals.values()].sort((a, b) => b.ids.length - a.ids.length)) {
    if (out.proposalsOff || made >= MAX_NEW_CATEGORIES || !(await db.saveProposal(p.kind, p.name, p.ids))) {
      out.unsure.push(...p.ids);
      continue;
    }
    made++;
    out.proposed.push({ name: p.name, kind: p.kind, count: p.ids.length });
  }
  out.categorized = out.byHistory + out.byAi;
  return out;
}

function finish(r: RoundResult): RoundResult {
  r.categorized = r.byHistory + r.byAi;
  return r;
}

// ---------- Supabase ----------

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>, max = 5000) {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message ?? "query failed");
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const missing = (e: { message?: string; code?: string } | null, what: string) =>
  Boolean(e && (e.code === "42703" || e.code === "42P01" || e.code === "PGRST204" || e.code === "PGRST205" || (e.message ?? "").includes(what)));

export function supabaseDb(sb: SupabaseClient, userId: string): Db {
  let markers = true;
  return {
    async categories() {
      const { data } = await sb.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null).order("name");
      return (data ?? []) as Cat[];
    },
    async uncategorized() {
      const rows = await pages<{ id: string; type: Kind; amount: number | string; description: string | null }>((a, b) =>
        sb.from("transactions").select("id,type,amount,description").eq("user_id", userId).is("category_id", null).is("deleted_at", null).order("occurred_at", { ascending: false }).range(a, b)
      );
      return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    },
    async history() {
      try {
        const rows = await pages<{ description: string | null; type: Kind; category_id: string; auto_category: string | null }>((a, b) =>
          sb.from("transactions").select("description,type,category_id,auto_category").eq("user_id", userId).not("category_id", "is", null).is("deleted_at", null).order("occurred_at", { ascending: false }).range(a, b)
        );
        return { rows: rows.map((r) => ({ type: r.type, description: r.description, category_id: r.category_id, manual: !r.auto_category })), markers: true };
      } catch {
        markers = false; // column auto_category doesn't exist yet
        const rows = await pages<{ description: string | null; type: Kind; category_id: string }>((a, b) =>
          sb.from("transactions").select("description,type,category_id").eq("user_id", userId).not("category_id", "is", null).is("deleted_at", null).order("occurred_at", { ascending: false }).range(a, b)
        );
        return { rows: rows.map((r) => ({ ...r, manual: true })), markers: false };
      }
    },
    async pendingProposals() {
      const { data, error } = await sb.from("category_proposals").select("id,name,kind,tx_ids,created_at").eq("user_id", userId).eq("status", "pending");
      if (error) return missing(error, "category_proposals") ? null : [];
      return (data ?? []) as ProposalRow[];
    },
    async declined() {
      const { data, error } = await sb.from("category_proposals").select("name,kind").eq("user_id", userId).eq("status", "rejected");
      if (error) return [];
      return ((data ?? []) as { name: string; kind: Kind }[]).map((r) => proposalKey(r.kind, r.name));
    },
    async saveProposal(kind, name, ids) {
      const { data: same, error } = await sb.from("category_proposals").select("id,name,kind,tx_ids").eq("user_id", userId).eq("status", "pending").eq("kind", kind);
      if (error) return false;
      const key = proposalKey(kind, name);
      const found = ((same ?? []) as ProposalRow[]).find((p) => proposalKey(p.kind, p.name) === key);
      if (found) {
        const { error: e } = await sb.from("category_proposals").update({ tx_ids: [...new Set([...found.tx_ids, ...ids])] }).eq("id", found.id).eq("user_id", userId);
        return !e;
      }
      const { error: e } = await sb.from("category_proposals").insert({ user_id: userId, name, kind, tx_ids: ids });
      return !e;
    },
    async apply(categoryId, ids, by) {
      const done: string[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const base = (patch: Record<string, unknown>) =>
          sb.from("transactions").update(patch).in("id", chunk).eq("user_id", userId).is("category_id", null).is("deleted_at", null).select("id");
        let r = markers ? await base({ category_id: categoryId, auto_category: by }) : await base({ category_id: categoryId });
        if (r.error && markers && missing(r.error, "auto_category")) {
          markers = false;
          r = await base({ category_id: categoryId });
        }
        if (!r.error) done.push(...((r.data ?? []) as { id: string }[]).map((x) => x.id));
      }
      return done;
    },
  };
}

/** Runs rounds for the nightly job: a few rounds, stopping when nothing is left, the AI refuses or time is up. */
export async function runNightly(sb: SupabaseClient, userId: string, budgetMs = 35_000) {
  if (!hasAi()) return null;
  const started = Date.now();
  const total = { categorized: 0, proposed: 0, unsure: 0 };
  await withAiUsage(
    "auto-categorize",
    async () => {
      const db = supabaseDb(sb, userId);
      let skip: string[] = [];
      for (let i = 0; i < 4 && Date.now() - started < budgetMs; i++) {
        const r = await runRound(db, { skip });
        total.categorized += r.categorized;
        total.proposed += r.proposed.length;
        skip = [...skip, ...r.unsure];
        total.unsure = skip.length;
        if (r.error || r.aiOff || r.left === 0) break;
      }
    },
    { sb, userId },
  );
  return total;
}
