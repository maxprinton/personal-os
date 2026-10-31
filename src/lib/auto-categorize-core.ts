// Auto-categorize (pure logic, no database, no network): turns messy bank text into a merchant key, learns from
// the transactions the user already categorized, groups what is left so the AI sees each merchant once,
// builds the prompt and reads the answer safely. The server part is lib/auto-categorize.ts.
import { fold } from "@/lib/bot/text";

export type Kind = "income" | "expense";
export type Cat = { id: string; name: string; kind: Kind };
export type Tx = { id: string; type: Kind; amount: number; description: string | null };
export type HistoryRow = { type: Kind; description: string | null; category_id: string; manual: boolean };
export type Confidence = "high" | "medium" | "low";

/** Words banks add to every line; they say nothing about what was bought. */
const NOISE = new Set(
  (
    "compra pos pago pagos tarjeta tarj debito credito deb cred tc tdc td transf transferencia transfer " +
    "purchase payment card visa mastercard master ref referencia nro num no numero com www http https " +
    "ec ecu ecuador quito guayaquil cuenca de del la el los las en a y por para con sa sas cia ltda cxa " +
    "pichincha pacifico produbanco bolivariano guayaquil internacional diners amex " +
    "consumo local compras app web online debit credit pmt ach wire"
  ).split(" ")
);

/** "COMPRA POS SUPERMAXI QUITO 00123 15/10" → ["supermaxi", "quito"] (accents, numbers, bank noise removed). */
export function merchantTokens(description: string | null | undefined): string[] {
  const text = fold(description ?? "")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z&]+/g, " ");
  return text
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w));
}

/** Keys to look a merchant up with, most specific first: "uber eats" before "uber". */
export function merchantKeys(description: string | null | undefined): string[] {
  const t = merchantTokens(description);
  const keys: string[] = [];
  for (const n of [3, 2, 1]) {
    if (t.length >= n) {
      const k = t.slice(0, n).join(" ");
      if (k.length >= 3 && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

// ---------- Learning from what the user already categorized ----------

export type History = { byKey: Map<string, Map<string, number>>; catName: Map<string, string> };

const slot = (type: Kind, key: string) => `${type}|${key}`;

/** Counts, for every merchant key, which category the user (not the AI) chose and how many times. */
export function buildHistory(rows: HistoryRow[], cats: Cat[]): History {
  const known = new Map(cats.map((c) => [c.id, c.name]));
  const byKey = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.manual || !known.has(r.category_id)) continue;
    for (const k of merchantKeys(r.description)) {
      const s = slot(r.type, k);
      const m = byKey.get(s) ?? new Map<string, number>();
      m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
      byKey.set(s, m);
    }
  }
  return { byKey, catName: known };
}

/**
 * The category the user always uses for this merchant, or null when there is no clear habit.
 * A long key ("uber eats") needs one example; a short one ("uber") needs two and 85% agreement.
 */
export function historyPick(h: History, type: Kind, description: string | null): string | null {
  const t = merchantTokens(description);
  for (const key of merchantKeys(description)) {
    const m = h.byKey.get(slot(type, key));
    if (!m) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [id, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const specific = key.split(" ").length >= 2 || t.length === 1 ? key.split(" ").length >= 2 : false;
    const needed = specific ? 1 : 2;
    if (total >= needed && n / total >= (specific ? 0.8 : 0.85)) return id;
  }
  return null;
}

/** "supermaxi → Food" lines from the user's own habits (most used first) so the AI copies their style. */
export function historyExamples(h: History, limit = 40): string[] {
  const rows: { line: string; n: number }[] = [];
  for (const [s, m] of h.byKey) {
    const [type, key] = [s.slice(0, s.indexOf("|")), s.slice(s.indexOf("|") + 1)];
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [id, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / total < 0.8 || key.split(" ").length > 2) continue;
    rows.push({ line: `${key} (${type}) → ${h.catName.get(id)}`, n: total });
  }
  // keep one line per merchant: the longest key already says it
  return rows
    .sort((a, b) => b.n - a.n || a.line.localeCompare(b.line))
    .slice(0, limit)
    .map((r) => r.line);
}

// ---------- Grouping: the AI sees each merchant once ----------

export type Group = { n: number; type: Kind; text: string; ids: string[]; min: number; max: number };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Same kind + same merchant key → one group (a $4 coffee ten times is one question, not ten). Biggest first. */
export function groupTransactions(txs: Tx[]): { groups: Group[]; blank: Tx[] } {
  const map = new Map<string, Group>();
  const blank: Tx[] = [];
  for (const t of txs) {
    const keys = merchantKeys(t.description);
    if (!keys.length) {
      blank.push(t);
      continue;
    }
    const s = slot(t.type, keys[0]);
    const g = map.get(s) ?? { n: 0, type: t.type, text: clip((t.description ?? "").replace(/\s+/g, " ").trim(), 90), ids: [], min: t.amount, max: t.amount };
    g.ids.push(t.id);
    g.min = Math.min(g.min, t.amount);
    g.max = Math.max(g.max, t.amount);
    map.set(s, g);
  }
  const groups = [...map.values()].sort((a, b) => b.ids.length - a.ids.length || b.max - a.max);
  groups.forEach((g, i) => (g.n = i + 1));
  return { groups, blank };
}

// ---------- The AI conversation ----------

/** Catch-all names: a guess that lands here is not really an answer. */
export const CATCH_ALL = /^(other|others|misc|miscellaneous|general|various|otros|otro|varios|diversos|other income)$/i;

export const SYSTEM = `You categorize one person's personal bank and cash transactions (USD). They live in Ecuador; descriptions are in Spanish or English and are often messy bank text with codes, city names and abbreviations ("COMPRA POS SUPERMAXI QUITO 0012", "DEB. AUTOM. CLARO", "TRANSF. A JUAN PEREZ").

You get the person's CATEGORIES (each is for expenses or for income), examples of how THEY categorized before, and numbered TRANSACTIONS (a merchant text, how many times it appears, the amount range).

How to decide:
- Make an educated guess from every clue: the brand or business (supermarket, pharmacy, gas station, streaming, telecom, restaurant, ride app, bank fee…), words in the text, the amount range, whether it is income or an expense, and the person's own examples. Most transactions have some clue, so do not be timid.
- Use ONLY a category from the list, spelled exactly as given, and only of the right kind: expense transactions get expense categories, income transactions get income categories.
- Pick the most specific category that fits. A catch-all such as "Other" is for things that really are miscellaneous, never a place to hide doubt.
- confidence: "high" = you know what it is; "medium" = a reasonable educated guess from the clues; "low" = there is truly nothing to go on (a person's name with no context, a bare code, a generic "transfer", "payment" or "withdrawal" that could be anything).
- When confidence is "low", set category to null. A wrong label is worse than a blank one for those only.
- NEW CATEGORIES: if none of the listed categories is a reasonable fit but you clearly know what the transaction is (confidence "high" or "medium"), you may propose a new category: set "category" to null and "new_category" to a short name (1-2 words, English, Title Case, in the style of the existing ones, e.g. "Subscriptions", "Pets", "Education"). Only propose a category that would hold many transactions over time, give similar transactions the exact same new name, reuse a name from PENDING PROPOSALS when it fits, and never propose a name listed under DECLINED. Never propose a new category when an existing one is a reasonable fit.

Reply with ONE JSON object only: {"results":[{"n":1,"category":"Food","confidence":"high"},{"n":2,"category":null,"new_category":"Pets","confidence":"medium"},{"n":3,"category":null,"confidence":"low"}]} with one entry per numbered transaction.`;

const usd = (n: number) => `$${n.toFixed(2)}`;

export function buildPrompt(cats: Cat[], groups: Group[], examples: string[], pending: string[] = [], declined: string[] = []): string {
  const list = (kind: Kind) => cats.filter((c) => c.kind === kind).map((c) => c.name);
  const lines = groups.map((g) => {
    const amount = g.min === g.max ? usd(g.min) : `${usd(g.min)}–${usd(g.max)}`;
    return `${g.n}. ${g.type} | "${g.text}" | ${g.ids.length}× | ${amount}`;
  });
  return [
    `EXPENSE categories: ${list("expense").join(", ") || "(none)"}`,
    `INCOME categories: ${list("income").join(", ") || "(none)"}`,
    examples.length ? `\nHow this person categorized before:\n${examples.join("\n")}` : "",
    pending.length ? `\nPENDING PROPOSALS (new categories already proposed, waiting for approval): ${pending.join(", ")}` : "",
    declined.length ? `\nDECLINED (never propose these): ${declined.join(", ")}` : "",
    `\nTRANSACTIONS:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type Guess = { category: string | null; newCategory: string | null; confidence: Confidence };

const conf = (v: unknown): Confidence => {
  const s = String(v ?? "").toLowerCase();
  return s.startsWith("h") ? "high" : s.startsWith("m") ? "medium" : "low";
};

/** Reads the model's JSON, however it is wrapped. Entries it didn't answer are simply missing. */
export function parseAnswer(text: string): Map<number, Guess> {
  const out = new Map<number, Guess>();
  // Candidates in the order they appear: {"results":[…]} or a bare […] (maybe inside a code fence)
  const spans = [
    [text.indexOf("{"), text.lastIndexOf("}")],
    [text.indexOf("["), text.lastIndexOf("]")],
  ]
    .filter(([from, to]) => from >= 0 && to > from)
    .sort((x, y) => x[0] - y[0]);
  let list: unknown[] = [];
  for (const [from, to] of spans) {
    let data: unknown;
    try {
      data = JSON.parse(text.slice(from, to + 1));
    } catch {
      continue;
    }
    const found = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results) ? (data as { results: unknown[] }).results : [];
    if (found.length) {
      list = found;
      break;
    }
  }
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const n = Number(r.n ?? r.i ?? r.id);
    if (!Number.isInteger(n)) continue;
    const text = (v: unknown) => {
      const t = typeof v === "string" ? v.trim() : "";
      return t && !/^(null|none|n\/a|uncategorized)$/i.test(t) ? t : null;
    };
    out.set(n, { category: text(r.category), newCategory: text(r.new_category ?? r.newCategory ?? r.proposal), confidence: conf(r.confidence ?? r.sure) });
  }
  return out;
}

/** The user's category the model meant ("food", "Food (income)", "Comida " …) or null. Kind must match. */
export function matchCategory(name: string | null, kind: Kind, cats: Cat[]): Cat | null {
  if (!name) return null;
  const clean = (s: string) => fold(s).replace(/\s*\((income|expense)\)\s*$/i, "").replace(/\s+/g, " ").trim();
  const want = clean(name);
  return cats.find((c) => c.kind === kind && clean(c.name) === want) ?? null;
}

/** A tidy name for a proposed category ("  \"pets\" (expense)" → "Pets"), or null when it isn't a usable name. */
export function cleanProposalName(raw: string | null | undefined): string | null {
  const t = (raw ?? "")
    .replace(/\s*\((income|expense)\)\s*$/i, "")
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 2 || t.length > 28 || t.split(" ").length > 3 || /[0-9]/.test(t) || !/\p{L}/u.test(t)) return null;
  return t
    .split(" ")
    .map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** The key a proposal is remembered by (declined / pending lists): kind + name without accents or case. */
export const proposalKey = (kind: Kind, name: string) => `${kind}|${fold(name).replace(/\s+/g, " ").trim()}`;

export type Decision = { kind: "category"; cat: Cat } | { kind: "proposal"; name: string } | { kind: "none" };

/**
 * What to do with one answer. "high" and "medium" count (educated guesses are the point); "low" stays for the
 * person. A listed category wins; otherwise a new one is only PROPOSED (never created here), unless it was declined.
 */
export function decide(g: Guess | undefined, kind: Kind, cats: Cat[], declined: Set<string> = new Set()): Decision {
  if (!g || g.confidence === "low") return { kind: "none" };
  const cat = matchCategory(g.category, kind, cats);
  if (cat) {
    // A catch-all with only "medium" confidence is a shrug, not a guess
    if (CATCH_ALL.test(cat.name.trim()) && g.confidence !== "high") return { kind: "none" };
    return { kind: "category", cat };
  }
  const name = cleanProposalName(g.newCategory ?? g.category);
  if (!name || CATCH_ALL.test(name)) return { kind: "none" };
  const existing = matchCategory(name, kind, cats);
  if (existing) return { kind: "category", cat: existing };
  if (declined.has(proposalKey(kind, name))) return { kind: "none" };
  return { kind: "proposal", name };
}
