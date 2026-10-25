import type { SupabaseClient } from "@supabase/supabase-js";
import { aiParse, describe, ruleParse, ruleTransfer, type Parsed } from "@/lib/parse";
import { localNow, zonedToUtc } from "@/lib/time";

// Works with both the signed-in user's client (RLS) and the admin client (Telegram).
// It always writes user_id explicitly, so with RLS it must match the signed-in user.

type Source = "web" | "mobile" | "telegram_bot";

/** An error whose message is safe and useful to show to the user as is. */
export class CaptureError extends Error {}

export async function userContext(supabase: SupabaseClient, userId: string) {
  const [{ data: settings }, { data: cats }, { data: accs }] = await Promise.all([
    supabase.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle(),
    supabase.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null),
    supabase.from("accounts").select("id,name").eq("user_id", userId).is("deleted_at", null).order("created_at"),
  ]);
  const timezone = (settings?.timezone as string | undefined) ?? "America/Guayaquil";
  return {
    timezone,
    today: localNow(timezone).date,
    categories: (cats ?? []) as { id: string; name: string; kind: "income" | "expense" }[],
    accounts: (accs ?? []) as AccountRef[],
  };
}

export type AccountRef = { id: string; name: string };

// ---- Account detection ------------------------------------------------------
// "spent 12 lunch from Pichincha" / "gasté 5 en uber con Visa": if the text names one of the
// user's accounts (whole name, or one word that belongs to exactly one account) the transaction
// is linked to it. Otherwise it stays unassigned until the user picks an account in Finance.

const fold = (s: string) =>
  [...s.normalize("NFC")].map((ch) => ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).join("").toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD_L = "(?<![\\p{L}\\p{N}])";
const WORD_R = "(?![\\p{L}\\p{N}])";
const PREP = "(?:(?:from|with|using|via|on|in|desde|con|de|en|por|usando)\\s+)?";

function phraseRe(needle: string, flags = "u") {
  return new RegExp(`${PREP}${WORD_L}${escapeRe(needle)}${WORD_R}`, flags);
}

export function findAccount(text: string, accounts: AccountRef[]): { account: AccountRef; needle: string } | null {
  if (!accounts.length) return null;
  const t = fold(text);
  const byName = accounts
    .map((a) => ({ a, needle: fold(a.name).trim() }))
    .filter((x) => x.needle && phraseRe(x.needle).test(t))
    .sort((x, y) => y.needle.length - x.needle.length)[0];
  if (byName) return { account: byName.a, needle: byName.needle };

  // One distinctive word of the name (e.g. "pichincha" for "Banco Pichincha"), only if no other account shares it
  const wordsOf = (a: AccountRef) => fold(a.name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const hits = new Map<string, { account: AccountRef; needle: string }>();
  for (const a of accounts) {
    for (const w of wordsOf(a)) {
      const shared = accounts.some((o) => o.id !== a.id && wordsOf(o).includes(w));
      if (!shared && phraseRe(w).test(t)) hits.set(a.id, { account: a, needle: w });
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** Removes "from <account>" from a description (same indexes in folded and original text). */
function stripAccount(description: string, needle: string) {
  const folded = fold(description);
  const m = phraseRe(needle, "iu").exec(folded);
  if (!m) return description;
  const out = (description.slice(0, m.index) + description.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

export async function parseMessage(text: string, today: string, categoryNames: string[]): Promise<{ parsed: Parsed; by: "ai" | "rules" }> {
  const ai = await aiParse(text, today, categoryNames);
  if (ai) return { parsed: ai, by: "ai" };
  return { parsed: ruleParse(text, today, categoryNames), by: "rules" };
}

/**
 * Whole pipeline: transfer? -> parse the text -> detect the account (money only) -> save.
 * accountId (optional) is the account picked in the app; an account named in the text wins.
 */
export async function processCapture(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  source: Source,
  accountId: string | null = null
) {
  const ctx = await userContext(supabase, userId);

  // "transfer 50 from cash to Pichincha": handled before the general parser
  const tr = ruleTransfer(text, ctx.today);
  if (tr) {
    const from = tr.parsed.from ? findAccount(tr.parsed.from, ctx.accounts)?.account : undefined;
    const to = tr.parsed.to ? findAccount(tr.parsed.to, ctx.accounts)?.account : undefined;
    if (from && to) {
      if (from.id === to.id) throw new CaptureError("Pick two different accounts for a transfer.");
      const parsed = { ...tr.parsed, from: from.name, to: to.name };
      const saved = await saveTransfer(supabase, userId, parsed, from, to, source, ctx);
      return { saved, parsed, by: "rules" as const };
    }
    if (tr.strict) {
      const names = ctx.accounts.map((a) => a.name).join(", ") || "none yet";
      throw new CaptureError(
        `I could not tell which accounts you mean. Try: "transfer 50 from <account> to <account>". Your accounts: ${names}.`
      );
    }
  }

  const { parsed, by } = await parseMessage(text, ctx.today, ctx.categories.map((c) => c.name));
  if (parsed.kind === "transfer") throw new CaptureError("Could not understand that transfer.");
  let account: AccountRef | null = null;
  let final = parsed;
  if (parsed.kind === "transaction") {
    const found = findAccount(text, ctx.accounts);
    if (found) {
      account = found.account;
      final = { ...parsed, description: stripAccount(parsed.description, found.needle) };
    } else if (accountId) {
      account = ctx.accounts.find((a) => a.id === accountId) ?? null;
    }
  }
  const saved = await saveParsed(supabase, userId, final, source, ctx, account);
  return { saved, parsed: final, by };
}

export async function saveTransfer(
  supabase: SupabaseClient,
  userId: string,
  parsed: Extract<Parsed, { kind: "transfer" }>,
  from: AccountRef,
  to: AccountRef,
  source: Source,
  ctx: Awaited<ReturnType<typeof userContext>>
): Promise<Saved> {
  const occurred_at =
    !parsed.date || parsed.date === ctx.today
      ? new Date().toISOString()
      : zonedToUtc(parsed.date, "12:00", ctx.timezone).toISOString();
  const { data, error } = await supabase
    .from("transfers")
    .insert({ user_id: userId, from_account_id: from.id, to_account_id: to.id, amount: parsed.amount, occurred_at, source })
    .select("id")
    .single();
  if (error || !data) throw new CaptureError(error?.message ?? "Could not save transfer");
  return { entityType: "transfer", id: data.id, summary: describe(parsed) };
}

export type Saved = { entityType: "task" | "note" | "transaction" | "transfer"; id: string; summary: string };

export async function saveParsed(
  supabase: SupabaseClient,
  userId: string,
  parsed: Exclude<Parsed, { kind: "transfer" }>,
  source: Source,
  ctx: Awaited<ReturnType<typeof userContext>>,
  account: AccountRef | null = null
): Promise<Saved> {
  if (parsed.kind === "task") {
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: userId, title: parsed.title, scheduled_for: parsed.date ?? ctx.today, source })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save task");
    return { entityType: "task", id: data.id, summary: describe(parsed) };
  }
  if (parsed.kind === "note") {
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: userId, title: parsed.title, content: parsed.content, source })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save note");
    return { entityType: "note", id: data.id, summary: describe(parsed) };
  }
  const category = parsed.category
    ? ctx.categories.find((c) => c.kind === parsed.txnType && c.name.toLowerCase() === parsed.category!.toLowerCase())
    : undefined;
  const occurred_at =
    !parsed.date || parsed.date === ctx.today
      ? new Date().toISOString()
      : zonedToUtc(parsed.date, "12:00", ctx.timezone).toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: parsed.txnType,
      amount: parsed.amount,
      description: parsed.description || null,
      category_id: category?.id ?? null,
      account_id: account?.id ?? null,
      occurred_at,
      source,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save transaction");
  const where = account ? ` · ${account.name}` : ctx.accounts.length ? " · no account yet (pick it in Finance)" : "";
  return {
    entityType: "transaction",
    id: data.id,
    summary: describe({ ...parsed, category: category?.name ?? null }) + where,
  };
}

const TABLE: Record<string, string> = { task: "tasks", note: "notes", transaction: "transactions", transfer: "transfers", habit: "habits" };

/** Soft-deletes what a capture created. */
export async function undoSaved(supabase: SupabaseClient, userId: string, entityType: string, id: string) {
  const table = TABLE[entityType];
  if (!table) return false;
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  return !error;
}
