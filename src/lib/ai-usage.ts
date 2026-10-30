// AI usage (server): every call to Groq is noted in the current "scope" (one Telegram message, one web
// request) and saved to ai_usage (migration 0025), with what Groq says is left. Groq has no API to ask
// for usage, so this record + its headers are the source: requests left today come straight from Groq
// (exact); tokens used today are counted here (only what Personal OS sends).
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Groq's free plan per model (Oct 2026): 1,000 requests a day, 200,000 tokens a day, 8,000 a minute. */
export const DAY_REQUESTS = 1000;
export const DAY_TOKENS = 200_000;

export type AiCall = {
  feature: string;
  model: string;
  prompt: number;
  completion: number;
  remReq?: number | null;
  limReq?: number | null;
  remTok?: number | null;
  limTok?: number | null;
  at: string;
};
type Store = { feature: string; calls: AiCall[]; saved: number; sb?: SupabaseClient; userId?: string; tz?: string; reported: boolean };
const als = new AsyncLocalStorage<Store>();

/** Runs fn in a usage scope (nested: only the feature name changes for the calls inside). */
export async function withAiUsage<T>(feature: string, fn: () => Promise<T>, bind?: { sb: SupabaseClient; userId: string }): Promise<T> {
  const cur = als.getStore();
  if (cur) {
    const before = cur.feature;
    cur.feature = feature;
    if (bind) Object.assign(cur, bind);
    try {
      return await fn();
    } finally {
      cur.feature = before;
    }
  }
  const store: Store = { feature, calls: [], saved: 0, reported: false, ...(bind ?? {}) };
  return als.run(store, async () => {
    try {
      return await fn();
    } finally {
      await flushAiUsage().catch(() => {});
    }
  });
}

/** Who the calls of this scope belong to (the bot learns it only after reading the message). */
export function bindAiUsage(sb: SupabaseClient, userId: string, tz?: string) {
  const s = als.getStore();
  if (s && !s.userId) Object.assign(s, { sb, userId, tz });
}
/** Who this scope's calls belong to (null = nobody yet). */
export function scopeOwner() {
  const s = als.getStore();
  return s?.sb && s.userId ? { sb: s.sb, userId: s.userId, tz: s.tz ?? "America/Guayaquil" } : null;
}

export function recordAiCall(call: Omit<AiCall, "feature" | "at">) {
  const s = als.getStore();
  if (!s) return;
  s.calls.push({ ...call, feature: s.feature, at: new Date().toISOString() });
}

/** Calls made in this scope so far. */
export const scopeCalls = () => als.getStore()?.calls ?? [];
export const scopeReported = () => als.getStore()?.reported ?? true;
export function markUsageReported() {
  const s = als.getStore();
  if (s) s.reported = true;
}

/** Saves the calls not saved yet (missing migration: quietly skipped). */
export async function flushAiUsage() {
  const s = als.getStore();
  if (!s?.sb || !s.userId || s.saved >= s.calls.length) return;
  const rows = s.calls.slice(s.saved).map((c) => ({
    user_id: s.userId,
    at: c.at,
    feature: c.feature,
    model: c.model,
    prompt_tokens: c.prompt,
    completion_tokens: c.completion,
    remaining_requests: c.remReq ?? null,
    limit_requests: c.limReq ?? null,
    remaining_tokens: c.remTok ?? null,
    limit_tokens: c.limTok ?? null,
  }));
  s.saved = s.calls.length;
  const { error } = await s.sb.from("ai_usage").insert(rows);
  if (error) console.warn("ai usage not saved:", error.message);
}

// ---------- Summaries ----------

export type UsageRow = { day: string; model: string; feature: string; calls: number; tokens: number };
export type UsageLatest = { model: string; at: string; remaining_requests: number | null; limit_requests: number | null; remaining_tokens: number | null; limit_tokens: number | null };
export type UsageSummary = { rows: UsageRow[]; latest: UsageLatest[] };

export async function usageSummary(sb: SupabaseClient, opts: { from: string; tz: string; userId?: string }): Promise<UsageSummary | null> {
  const { data, error } = await sb.rpc("ai_usage_summary", { p_from: opts.from, p_tz: opts.tz, p_user: opts.userId ?? null });
  if (error || !data) return null;
  const d = data as { rows?: UsageRow[]; latest?: UsageLatest[] };
  return { rows: (d.rows ?? []).map((r) => ({ ...r, calls: Number(r.calls), tokens: Number(r.tokens) })), latest: d.latest ?? [] };
}

export const fmtK = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const num = (n: number) => n.toLocaleString("en-US");
const FEATURE: Record<string, string> = {
  "bot-ask": "Telegram @os",
  telegram: "Telegram (voice, photos, messages)",
  "notes-ai": "✨ AI in notes",
  "notes-summary": "AI summary property",
  writing: "Writing checker",
  voice: "Writing voice profile",
  other: "Other",
};
export const featureName = (f: string) => FEATURE[f] ?? f;

/** Today's numbers for one model (the one this answer used) from a summary of today. */
function modelToday(sum: UsageSummary | null, day: string, model: string) {
  const rows = (sum?.rows ?? []).filter((r) => r.day === day && r.model === model);
  return { tokens: rows.reduce((s, r) => s + r.tokens, 0), calls: rows.reduce((s, r) => s + r.calls, 0) };
}

/**
 * "✨ 1,840 tokens · today 23.4K of 200K tokens · 912 of 1,000 requests left · 12% of today's limit"
 * calls = the calls of this answer; sum = today's summary (after saving them); day = today (YYYY-MM-DD).
 */
export function usageLine(calls: AiCall[], sum: UsageSummary | null, day: string): string | null {
  if (!calls.length) return null;
  const tokens = calls.reduce((s, c) => s + c.prompt + c.completion, 0);
  const last = [...calls].reverse().find((c) => c.model) ?? calls.at(-1)!;
  const today = modelToday(sum, day, last.model);
  const usedTok = Math.max(today.tokens, tokens);
  const left = last.remReq ?? null;
  const limit = last.limReq ?? DAY_REQUESTS;
  const reqPct = left !== null && limit ? (limit - left) / limit : today.calls / DAY_REQUESTS;
  const pct = Math.round(Math.max(usedTok / DAY_TOKENS, reqPct) * 100);
  const parts = [`✨ ${num(tokens)} tokens`, `today ${fmtK(usedTok)} of ${fmtK(DAY_TOKENS)} tokens`];
  if (left !== null) parts.push(`${num(left)} of ${num(limit)} requests left`);
  parts.push(`${pct}% of today's limit`);
  return parts.join(" · ");
}

/** Local midnight of `day` in tz, as an ISO time (for "since today"). */
export function startOfDay(day: string, tz: string) {
  const guess = new Date(`${day}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const offset = local.getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

/** The line for what this scope used, after saving it. */
export async function scopeUsageLine(sb: SupabaseClient, userId: string, tz: string, day: string) {
  const calls = scopeCalls();
  if (!calls.length) return null;
  await flushAiUsage().catch(() => {});
  const sum = await usageSummary(sb, { from: startOfDay(day, tz), tz, userId }).catch(() => null);
  return usageLine(calls, sum, day);
}

/** Plain-text report for Telegram /usage and the morning message. */
export function usageReport(sum: UsageSummary | null, day: string, opts: { title?: string; short?: boolean } = {}) {
  if (!sum) return "✨ AI usage isn't available yet (run MIGRACION-0025-uso-de-ia.sql in Supabase).";
  const rows = sum.rows.filter((r) => r.day === day);
  const tokens = rows.reduce((s, r) => s + r.tokens, 0);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  if (opts.short) return calls ? `✨ AI ${opts.title ?? "today"}: ${fmtK(tokens)} tokens in ${calls} ${calls === 1 ? "request" : "requests"}.` : null;
  const lines = [`✨ AI usage ${opts.title ?? "today"} (Groq free plan)`, "", `• ${num(calls)} requests · ${num(tokens)} tokens`];
  const byModel = new Map<string, { calls: number; tokens: number }>();
  const byFeature = new Map<string, { calls: number; tokens: number }>();
  for (const r of rows) {
    for (const [m, k] of [
      [byModel, r.model],
      [byFeature, r.feature],
    ] as const) {
      const cur = m.get(k) ?? { calls: 0, tokens: 0 };
      cur.calls += r.calls;
      cur.tokens += r.tokens;
      m.set(k, cur);
    }
  }
  if (byModel.size) {
    lines.push("", "By model (each has its own daily limit):");
    for (const [model, v] of [...byModel].sort((a, b) => b[1].tokens - a[1].tokens)) {
      const latest = sum.latest.find((l) => l.model === model);
      const left = latest && latest.remaining_requests !== null && latest.at.slice(0, 10) >= day.slice(0, 10) ? ` · ${num(latest.remaining_requests)} of ${num(latest.limit_requests ?? DAY_REQUESTS)} requests left` : "";
      const tpd = model.startsWith("whisper") ? "" : ` · ${fmtK(v.tokens)} of ${fmtK(DAY_TOKENS)} tokens (${Math.round((v.tokens / DAY_TOKENS) * 100)}%)`;
      lines.push(`• ${model}: ${v.calls} requests${tpd}${left}`);
    }
  }
  if (byFeature.size) {
    lines.push("", "By feature:");
    for (const [f, v] of [...byFeature].sort((a, b) => b[1].tokens - a[1].tokens)) lines.push(`• ${featureName(f)}: ${v.calls} · ${fmtK(v.tokens)} tokens`);
  }
  if (!calls) lines.push("", "Nothing used yet today.");
  lines.push("", "Requests left come from Groq; tokens are counted by Personal OS (only what it sends).");
  return lines.join("\n");
}
