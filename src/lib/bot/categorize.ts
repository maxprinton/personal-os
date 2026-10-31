// Auto-categorize from Telegram (server only): /categorize reads the uncategorized transactions (one round, then
// "send it again" for more), and NEW categories the AI proposes arrive with ✓ / ✕ buttons (/proposals, or in the
// morning message). Same functions as the web: lib/auto-categorize.ts and lib/category-proposals.ts.
import { hasAi } from "@/lib/ai";
import { runRound, supabaseDb } from "@/lib/auto-categorize";
import { withAiUsage } from "@/lib/ai-usage";
import { approveProposal, listProposals, rejectProposal, type Proposal } from "@/lib/category-proposals";
import type { Ctx } from "@/lib/bot/core";
import { btn, pk, type Kb } from "@/lib/bot/tg";

type Reply = { text: string; kb: Kb };

/** The proposals as one message: a line each, with ✓ Create / ✕ Skip buttons. null when there are none. */
export function proposalsReply(list: Proposal[], intro = "🆕 New categories proposed by the AI"): Reply | null {
  if (!list.length) return null;
  const shown = list.slice(0, 8);
  const lines = shown.map((p, i) => `${i + 1}. “${p.name}” (${p.kind}) · ${p.count} transaction${p.count === 1 ? "" : "s"}${p.samples.length ? `: ${p.samples.slice(0, 3).join(", ")}` : ""}`);
  const kb: Kb = shown.map((p) => [btn(`✓ Create “${p.name}”`, `cp:${pk(p.id)}:y`), btn("✕ Skip", `cp:${pk(p.id)}:n`)]);
  return { text: `${intro}\n\n${lines.join("\n")}\n\n✓ creates the category and applies it to those transactions. ✕ means “never propose this again”.`, kb };
}

export async function proposalsView(c: Ctx): Promise<Reply> {
  const list = await listProposals(c.admin, c.userId);
  return proposalsReply(list) ?? { text: "🆕 No new categories are waiting for you. ✓", kb: [] };
}

/** /categorize: one round (Telegram gives the bot ~30 s), then the result and any proposals. */
export async function categorizeView(c: Ctx): Promise<Reply> {
  const db = supabaseDb(c.admin, c.userId);
  const r = await withAiUsage("auto-categorize", () => runRound(db, { ask: hasAi() ? undefined : null }));
  const lines: string[] = [];
  if (!r.checked && !r.left && !r.error) lines.push("✨ Nothing to categorize — every transaction has a category. ✓");
  else {
    lines.push(`✨ ${r.categorized} categorized${r.byHistory ? ` (${r.byHistory} from your habits, ${r.byAi} by AI)` : ""}`);
    if (r.unsure.length) lines.push(`🤷 ${r.unsure.length} too unclear — categorize them on the web (Finance → Uncategorized).`);
    if (r.left) lines.push(`⏳ ${r.left} more to go — send /categorize again.`);
  }
  if (r.error) lines.push(`⚠️ ${r.error}`);
  if (r.aiOff) lines.push("The AI isn't connected (GROQ_API_KEY): only your own habits were used.");
  if (r.proposalsOff) lines.push("To let the AI propose categories, run MIGRACION-0026-categorias-automaticas.sql in Supabase.");
  else if (!r.markers) lines.push("Run MIGRACION-0026-categorias-automaticas.sql to see which ones were automatic.");
  const prop = proposalsReply(await listProposals(c.admin, c.userId));
  return { text: `${lines.join("\n")}${prop ? `\n\n${prop.text}` : ""}`, kb: prop?.kb ?? [] };
}

/** Button ✓ / ✕ on a proposal. Returns the toast and the new text of the message part. */
export async function answerProposal(c: Ctx, id: string, yes: boolean): Promise<{ ok: boolean; text: string }> {
  if (!id) return { ok: false, text: "That proposal expired." };
  if (!yes) {
    const r = await rejectProposal(c.admin, c.userId, id);
    return r.ok ? { ok: true, text: `✕ Skipped “${r.name}” — it won't be proposed again.` } : { ok: false, text: r.error ?? "Already answered." };
  }
  const r = await approveProposal(c.admin, c.userId, id);
  if (!r.ok) return { ok: false, text: r.error };
  return { ok: true, text: `✓ ${r.created ? "Created" : "Using"} “${r.name}” · ${r.applied} transaction${r.applied === 1 ? "" : "s"} categorized.` };
}
