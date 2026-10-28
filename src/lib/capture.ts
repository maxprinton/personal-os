import type { SupabaseClient } from "@supabase/supabase-js";
import { aiParse, describe, ruleGuess, ruleParseStrict, ruleTransfer, validateParsed, type Parsed } from "@/lib/parse";
import { geminiJson } from "@/lib/gemini";
import { localNow, zonedToUtc } from "@/lib/time";
import { getBlockTypes } from "@/lib/calendar/model";
import { autoPlaceTasks } from "@/lib/calendar/tasks";
import { bestMatches } from "@/lib/bot/text";

// Works with both the signed-in user's client (RLS) and the admin client (Telegram).
// It always writes user_id explicitly, so with RLS it must match the signed-in user.

type Source = "web" | "mobile" | "telegram_bot";

/** An error whose message is safe and useful to show to the user as is. */
export class CaptureError extends Error {}

/**
 * Thrown (only when processCapture is called with askAccount) for a money message that names no
 * account while the user has accounts: the Telegram bot then asks which account before saving.
 */
export class AccountChoiceNeeded extends Error {
  constructor(
    public parsed: Extract<Parsed, { kind: "transaction" }>,
    public by: "ai" | "rules",
    public accounts: AccountRef[]
  ) {
    super("Which account?");
  }
}

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
export function stripAccount(description: string, needle: string) {
  const folded = fold(description);
  const m = phraseRe(needle, "iu").exec(folded);
  if (!m) return description;
  const out = (description.slice(0, m.index) + description.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

/** Clear patterns → rules (instant, nothing leaves the app). Anything else → AI if a key exists → rules' guess. */
export async function parseMessage(
  text: string,
  today: string,
  categoryNames: string[],
  accountNames: string[] = []
): Promise<{ parsed: Parsed; by: "ai" | "rules" }> {
  const strict = ruleParseStrict(text, today, categoryNames);
  if (strict) return { parsed: strict, by: "rules" };
  const ai = await aiParse(text, today, categoryNames, accountNames);
  if (ai) return { parsed: ai, by: "ai" };
  return { parsed: ruleGuess(text, today), by: "rules" };
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
  accountId: string | null = null,
  askAccount = false
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

  const { parsed, by } = await parseMessage(
    text,
    ctx.today,
    ctx.categories.map((c) => c.name),
    ctx.accounts.map((a) => a.name)
  );
  return finishCapture(supabase, userId, parsed, by, text, source, ctx, accountId, askAccount);
}

/** After parsing: transfer accounts, the transaction's account (named in `accountText`), then save. */
async function finishCapture(
  supabase: SupabaseClient,
  userId: string,
  parsed: Parsed,
  by: "ai" | "rules",
  accountText: string,
  source: Source,
  ctx: Awaited<ReturnType<typeof userContext>>,
  accountId: string | null,
  askAccount: boolean
) {
  if (parsed.kind === "transfer") {
    // Only the AI gives this shape here (the rules' transfers are handled before)
    const from = findAccount(parsed.from, ctx.accounts)?.account;
    const to = findAccount(parsed.to, ctx.accounts)?.account;
    if (!from || !to || from.id === to.id) {
      const names = ctx.accounts.map((a) => a.name).join(", ") || "none yet";
      throw new CaptureError(`I could not tell which accounts you mean. Try: "transfer 50 from <account> to <account>". Your accounts: ${names}.`);
    }
    const final = { ...parsed, from: from.name, to: to.name };
    const saved = await saveTransfer(supabase, userId, final, from, to, source, ctx);
    return { saved, parsed: final as Parsed, by };
  }
  let account: AccountRef | null = null;
  let final = parsed;
  if (parsed.kind === "transaction") {
    const found = findAccount(accountText, ctx.accounts);
    if (found) {
      account = found.account;
      final = { ...parsed, description: stripAccount(parsed.description, found.needle) };
    } else if (accountId) {
      account = ctx.accounts.find((a) => a.id === accountId) ?? null;
    } else if (askAccount && ctx.accounts.length > 0) {
      throw new AccountChoiceNeeded(parsed, by, ctx.accounts);
    }
  }
  const saved = await saveParsed(supabase, userId, final, source, ctx, account);
  return { saved, parsed: final, by };
}

/** Saves a transaction that was waiting for its account (Telegram button). account = null means "no account". */
export async function savePendingTransaction(
  supabase: SupabaseClient,
  userId: string,
  parsed: Extract<Parsed, { kind: "transaction" }>,
  accountId: string | null
) {
  const ctx = await userContext(supabase, userId);
  const account = accountId ? ctx.accounts.find((a) => a.id === accountId) ?? null : null;
  if (accountId && !account) throw new CaptureError("That account no longer exists. Send the message again.");
  return saveParsed(supabase, userId, parsed, "telegram_bot", ctx, account);
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
    // "@Gym" = home block (the task goes into it on its day), "#work" = tag. A past day becomes today.
    const { text: title, tags } = pullTags(parsed.title);
    let homeId: string | null = null;
    let homeName: string | null = null;
    let finalTitle = title;
    const at = /(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N}_-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}_-]*)?)/u.exec(title);
    if (at) {
      const types = await getBlockTypes(supabase, userId);
      // "@Deep work" (two words) first, then "@Deep"
      for (const cand of [at[1], at[1].split(/\s+/)[0]]) {
        const found = bestMatches(types, cand, (t) => t.name);
        if (found.length === 1) {
          homeId = found[0].id;
          homeName = found[0].name;
          finalTitle = title.replace(`@${cand}`, " ").replace(/\s{2,}/g, " ").trim();
          break;
        }
      }
    }
    if (!finalTitle) finalTitle = parsed.title.trim() || "Task";
    const day = parsed.date && parsed.date >= ctx.today ? parsed.date : ctx.today;
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: userId, title: finalTitle, scheduled_for: day, source, ...(homeId ? { home_block_type_id: homeId } : {}) })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save task");
    if (homeId) await autoPlace(supabase, userId, ctx.today);
    if (tags.length) await addTags(supabase, userId, "task", data.id as string, tags);
    const summary =
      describe({ ...parsed, title: finalTitle, date: day === ctx.today ? null : day }) +
      (homeName ? ` · home: ${homeName}` : "") +
      (tags.length ? ` · #${tags.join(" #")}` : "");
    return { entityType: "task", id: data.id, summary };
  }
  if (parsed.kind === "note") {
    const { tags } = pullTags(`${parsed.title}\n${parsed.content}`);
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: userId, title: parsed.title, content: parsed.content, source })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save note");
    if (tags.length) await addTags(supabase, userId, "note", data.id as string, tags);
    return { entityType: "note", id: data.id, summary: describe(parsed) + (tags.length ? ` · #${tags.join(" #")}` : "") };
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

/**
 * A photo (receipt, invoice, bill) → an expense or income, read by Gemini. The caption can add or
 * correct details ("from Pichincha", "es de ayer"). Something that isn't a receipt becomes a note.
 */
export async function processImageCapture(
  supabase: SupabaseClient,
  userId: string,
  image: { base64: string; mimeType: string },
  caption: string,
  source: Source,
  askAccount = false
) {
  const ctx = await userContext(supabase, userId);
  const categories = ctx.categories.map((c) => c.name);
  const system = [
    `Today is ${ctx.today}. The user sent a photo${caption ? " with a caption" : ""} to their personal finance and tasks app.`,
    `If it is a receipt, invoice, bill or payment proof, return ONE JSON object:`,
    `{"kind":"transaction","txnType":"expense"|"income","amount":number,"description":string,"category":string|null,"date":"YYYY-MM-DD"|null,"paidWith":string|null}`,
    `amount = the TOTAL actually paid (USD). description = the store or what it was for, short. date = the date printed on it, or null.`,
    `category must be one of: ${categories.length ? categories.join(", ") : "(none)"} or null. paidWith = card or bank printed on it, if any.`,
    `If it is anything else, return {"kind":"note","title":string,"content":string} describing it briefly.`,
    `The caption, if any, comes from the user and wins over what the photo shows (e.g. a different date or account).`,
  ].join("\n");
  const out = await geminiJson(system, [
    ...(caption ? [{ text: `Caption: ${caption.slice(0, 500)}` }] : []),
    { inline_data: { mime_type: image.mimeType, data: image.base64 } },
  ]);
  const parsed = validateParsed(out);
  if (!parsed) throw new CaptureError("I could not read that photo. Try a sharper photo of the receipt, or type it: \"spent 12 lunch\".");
  const paidWith = out && typeof out === "object" && typeof (out as { paidWith?: unknown }).paidWith === "string" ? (out as { paidWith: string }).paidWith : "";
  // The caption names the account first; otherwise what the receipt shows (e.g. "VISA Pichincha")
  const accountText = findAccount(caption, ctx.accounts) ? caption : `${caption} ${paidWith}`.trim();
  return finishCapture(supabase, userId, parsed, "ai", accountText, source, ctx, null, askAccount);
}

/** "#work #ideas" → tags (and the text without them). Only words that start with a letter count. */
export function pullTags(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const out = text.replace(/(^|\s)#([\p{L}][\p{L}\p{N}_-]{0,39})/gu, (_m, pre: string, name: string) => {
    if (!tags.some((t) => t.toLowerCase() === name.toLowerCase())) tags.push(name);
    return pre;
  });
  return { text: out.replace(/\s{2,}/g, " ").trim(), tags };
}

/** Adds tags to a task or note (creates missing tags). Filters by user_id, so it works with the admin client. */
export async function addTags(supabase: SupabaseClient, userId: string, entityType: "task" | "note", entityId: string, names: string[]) {
  const { data: existing } = await supabase.from("tags").select("id,name").eq("user_id", userId).is("deleted_at", null);
  const byName = new Map(((existing ?? []) as { id: string; name: string }[]).map((t) => [t.name.toLowerCase(), t.id]));
  const ids: string[] = [];
  for (const name of names) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const { data } = await supabase.from("tags").insert({ user_id: userId, name }).select("id").single();
      if (!data) continue;
      id = data.id as string;
      byName.set(name.toLowerCase(), id);
    }
    ids.push(id);
  }
  if (ids.length) {
    await supabase.from("entity_tags").insert(ids.map((tag_id) => ({ user_id: userId, tag_id, entity_type: entityType, entity_id: entityId })));
  }
}

/** Puts tasks with a home block into that block on their day (same as the calendar does each morning). */
async function autoPlace(supabase: SupabaseClient, userId: string, today: string) {
  await autoPlaceTasks(supabase, userId, today).catch(() => 0);
}
