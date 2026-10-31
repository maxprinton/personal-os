// Category proposals (server only): the AI proposes a NEW category when none of the user's fits; nothing is created
// until the user approves (web or Telegram, same functions). Approve → the category is created (or the existing one
// with that name is reused) and applied to the transactions it was proposed for. Skip → remembered, never proposed again.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanProposalName, proposalKey, type Kind } from "@/lib/auto-categorize-core";

export type Proposal = { id: string; name: string; kind: Kind; count: number; samples: string[]; createdAt: string };

type Row = { id: string; name: string; kind: Kind; tx_ids: string[]; created_at: string };

/** Pending proposals with how many of their transactions are still uncategorized (the rest were handled by hand). */
export async function listProposals(sb: SupabaseClient, userId: string): Promise<Proposal[]> {
  const { data, error } = await sb.from("category_proposals").select("id,name,kind,tx_ids,created_at").eq("user_id", userId).eq("status", "pending").order("created_at");
  if (error || !data?.length) return [];
  const out: Proposal[] = [];
  for (const p of data as Row[]) {
    const ids = p.tx_ids.slice(0, 500);
    const { data: tx } = ids.length
      ? await sb.from("transactions").select("id,description,amount").eq("user_id", userId).in("id", ids).is("category_id", null).is("deleted_at", null).order("occurred_at", { ascending: false })
      : { data: [] };
    const rows = (tx ?? []) as { id: string; description: string | null; amount: number | string }[];
    if (!rows.length) {
      await sb.from("category_proposals").update({ status: "expired", resolved_at: new Date().toISOString() }).eq("id", p.id).eq("user_id", userId);
      continue;
    }
    const samples = [...new Set(rows.map((r) => (r.description ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 4);
    out.push({ id: p.id, name: p.name, kind: p.kind, count: rows.length, samples, createdAt: p.created_at });
  }
  return out;
}

export type ProposalResult = { ok: true; name: string; created: boolean; applied: number } | { ok: false; error: string };

/** Creates the category (or reuses the one with that name) and applies it to the proposal's transactions. */
export async function approveProposal(sb: SupabaseClient, userId: string, id: string, rename?: string | null): Promise<ProposalResult> {
  const { data: p } = await sb.from("category_proposals").select("id,name,kind,tx_ids,status").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!p) return { ok: false, error: "That proposal no longer exists." };
  if (p.status !== "pending") return { ok: false, error: "That proposal was already answered." };
  const kind = p.kind as Kind;
  const name = cleanProposalName(rename?.trim() ? rename : (p.name as string));
  if (!name) return { ok: false, error: "Use a short name (1–3 words, no numbers)." };

  const find = async () => {
    const { data } = await sb.from("categories").select("id,name").eq("user_id", userId).eq("kind", kind).is("deleted_at", null);
    return ((data ?? []) as { id: string; name: string }[]).find((c) => proposalKey(kind, c.name) === proposalKey(kind, name));
  };
  let cat = await find();
  const created = !cat;
  if (!cat) {
    const ins = await sb.from("categories").insert({ user_id: userId, name, kind }).select("id,name").single();
    if (ins.error) cat = await find(); // created in parallel (unique name)
    else cat = ins.data as { id: string; name: string };
    if (!cat) return { ok: false, error: ins.error?.message ?? "Could not create the category." };
  }
  let applied = 0;
  const ids = (p.tx_ids as string[]) ?? [];
  for (let i = 0; i < ids.length; i += 100) {
    const base = (patch: Record<string, unknown>) =>
      sb.from("transactions").update(patch).in("id", ids.slice(i, i + 100)).eq("user_id", userId).eq("type", kind).is("category_id", null).is("deleted_at", null).select("id");
    let r = await base({ category_id: cat.id, auto_category: "ai" });
    if (r.error) r = await base({ category_id: cat.id });
    applied += r.data?.length ?? 0;
  }
  await sb.from("category_proposals").update({ status: "approved", category_id: cat.id, resolved_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
  return { ok: true, name: cat.name, created, applied };
}

export async function rejectProposal(sb: SupabaseClient, userId: string, id: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const { data } = await sb
    .from("category_proposals")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("name");
  return data?.length ? { ok: true, name: (data[0] as { name: string }).name } : { ok: false, error: "That proposal was already answered." };
}

/** Undo of an automatic run: only transactions still marked ✨ and still in that category go back to uncategorized. */
export async function undoAuto(sb: SupabaseClient, userId: string, applied: { id: string; categoryId: string }[]) {
  const byCat = new Map<string, string[]>();
  for (const a of applied) byCat.set(a.categoryId, [...(byCat.get(a.categoryId) ?? []), a.id]);
  let undone = 0;
  for (const [categoryId, ids] of byCat) {
    for (let i = 0; i < ids.length; i += 100) {
      const q = (marked: boolean) => {
        let b = sb.from("transactions").update({ category_id: null, ...(marked ? { auto_category: null } : {}) }).in("id", ids.slice(i, i + 100)).eq("user_id", userId).eq("category_id", categoryId);
        if (marked) b = b.not("auto_category", "is", null);
        return b.select("id");
      };
      let r = await q(true);
      if (r.error) r = await q(false); // no marker column: the category match is the only guard
      undone += r.data?.length ?? 0;
    }
  }
  return undone;
}

/** "Looks right": removes the ✨ from everything (or from the given ids). */
export async function confirmAuto(sb: SupabaseClient, userId: string, ids?: string[]) {
  let q = sb.from("transactions").update({ auto_category: null }).eq("user_id", userId).not("auto_category", "is", null);
  if (ids?.length) q = q.in("id", ids.slice(0, 500));
  const { data } = await q.select("id");
  return data?.length ?? 0;
}
