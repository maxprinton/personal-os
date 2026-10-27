// Turns a free-text message ("spent 12 on lunch", "task: call mom tomorrow") into a
// structured item. Clear patterns are handled by the rules (instant, private). Anything else goes
// to the AI when a key exists (Gemini: GEMINI_API_KEY; or Claude: ANTHROPIC_API_KEY), and the
// rules' best guess is the fallback.
import { geminiJson, hasGemini } from "@/lib/gemini";

export type Parsed =
  | { kind: "task"; title: string; date: string | null }
  | { kind: "note"; title: string; content: string }
  | { kind: "transfer"; amount: number; from: string; to: string; date: string | null }
  | {
      kind: "transaction";
      txnType: "income" | "expense";
      amount: number;
      description: string;
      category: string | null;
      date: string | null;
    };

const NUM = String.raw`\$?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:usd|dollars?|dólares?|dolares?|\$)?`;

const CATEGORY_WORDS: Record<string, string[]> = {
  Food: ["lunch", "dinner", "breakfast", "coffee", "groceries", "grocery", "restaurant", "food", "pizza", "snack",
    "almuerzo", "comida", "cena", "desayuno", "café", "cafe", "supermercado", "mercado"],
  Transport: ["uber", "taxi", "bus", "gas", "fuel", "parking", "metro", "gasolina", "pasaje", "transporte", "peaje"],
  Home: ["rent", "electricity", "water bill", "internet", "arriendo", "alquiler", "luz", "agua", "casa"],
  Health: ["pharmacy", "doctor", "medicine", "gym", "dentist", "farmacia", "medicina", "médico", "medico", "gimnasio"],
  Fun: ["movie", "cinema", "netflix", "spotify", "bar", "beer", "game", "cine", "cerveza", "fiesta"],
  Salary: ["salary", "paycheck", "payroll", "sueldo", "salario", "nómina", "nomina"],
};

export function guessCategory(text: string, available: string[] = []): string | null {
  const t = text.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(t))) {
      if (!available.length || available.some((a) => a.toLowerCase() === cat.toLowerCase())) return cat;
    }
  }
  for (const a of available) {
    if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return a;
  }
  return null;
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pulls "today / tomorrow / yesterday / hoy / mañana / ayer" out of a text. */
function extractDay(text: string, today: string): { text: string; date: string | null } {
  const rules: [RegExp, number][] = [
    [/\b(tomorrow|mañana|manana)\b/i, 1],
    [/\b(yesterday|ayer)\b/i, -1],
    [/\b(today|hoy)\b/i, 0],
  ];
  for (const [re, n] of rules) {
    if (re.test(text)) {
      return { text: text.replace(re, "").replace(/\s{2,}/g, " ").trim(), date: addDays(today, n) };
    }
  }
  return { text, date: null };
}

const toAmount = (s: string) => Math.round(Number(s.replace(",", ".")) * 100) / 100;
const clean = (s: string) => s.replace(/^(on|for|at|en|de|por|para)\s+/i, "").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const MOVE_STRICT = String.raw`(?:transfer|transfers|transferred|transferir|transfiere|transferí|transferi)`;
const MOVE_SOFT = String.raw`(?:move|moved|mover|moví|movi)`;

/**
 * "transfer 50 from cash to Pichincha", "transferí 50 de efectivo a visa hoy", "move 20 cash to visa".
 * Returns the raw account fragments; capture.ts resolves them against the user's accounts.
 * strict = the verb is unambiguous (an error is shown if the accounts are not found).
 */
export function ruleTransfer(input: string, today: string): { parsed: Extract<Parsed, { kind: "transfer" }>; strict: boolean } | null {
  const text = input.trim();
  const m = new RegExp(`^(${MOVE_STRICT}|${MOVE_SOFT})\\s+${NUM}\\s+([\\s\\S]+)$`, "i").exec(text);
  if (!m) return null;
  const strict = new RegExp(`^${MOVE_STRICT}$`, "i").test(m[1]);
  const d = extractDay(m[3].trim(), today);
  const rest = d.text;
  const TO = "(?:to|a|hacia|into|para)";
  const FROM = "(?:from|de|desde)";
  let from: string | undefined;
  let to: string | undefined;
  let r = new RegExp(`^${FROM}\\s+(.+?)\\s+${TO}\\s+(.+)$`, "i").exec(rest);
  if (r) { from = r[1]; to = r[2]; }
  if (!r) {
    r = new RegExp(`^${TO}\\s+(.+?)\\s+${FROM}\\s+(.+)$`, "i").exec(rest);
    if (r) { to = r[1]; from = r[2]; }
  }
  if (!r) {
    r = new RegExp(`^(.+?)\\s+${TO}\\s+(.+)$`, "i").exec(rest);
    if (r) { from = r[1]; to = r[2]; }
  }
  if (!from || !to) return strict ? { parsed: { kind: "transfer", amount: toAmount(m[2]), from: "", to: "", date: d.date }, strict } : null;
  return { parsed: { kind: "transfer", amount: toAmount(m[2]), from: from.trim(), to: to.trim(), date: d.date }, strict };
}

export function ruleParse(input: string, today: string, categories: string[] = []): Parsed {
  return ruleParseStrict(input, today, categories) ?? ruleGuess(input, today);
}

/** The rules' guess for a message without a clear pattern: long text = note, short = task. */
export function ruleGuess(input: string, today: string): Parsed {
  const text = input.trim();
  if (text.includes("\n") || text.length > 140) {
    const [first, ...rest] = text.split("\n");
    return { kind: "note", title: first.slice(0, 120), content: rest.length ? rest.join("\n").trim() : text };
  }
  const d = extractDay(text, today);
  return { kind: "task", title: cap(d.text), date: d.date };
}

/** Only messages with a clear pattern (task:, note:, spent 12…, +300…, $45…); null otherwise. */
export function ruleParseStrict(input: string, today: string, categories: string[] = []): Parsed | null {
  const text = input.trim();

  let m = /^(?:task|todo|tarea|t)\s*[:\-]\s*([\s\S]+)$/i.exec(text);
  if (m) {
    const d = extractDay(m[1].trim(), today);
    return { kind: "task", title: cap(d.text), date: d.date };
  }

  m = /^(?:note|nota|n)\s*[:\-]\s*([\s\S]+)$/i.exec(text);
  if (m) {
    const body = m[1].trim();
    const [first, ...rest] = body.split("\n");
    return { kind: "note", title: first.slice(0, 120), content: rest.length ? rest.join("\n").trim() : body };
  }

  m = new RegExp(`^(?:spent|paid|bought|pay|gast[eé]|pagu[eé]|compr[eé])\\s+${NUM}\\s*([\\s\\S]*)$`, "i").exec(text);
  if (m) {
    const d = extractDay(clean(m[2]), today);
    return { kind: "transaction", txnType: "expense", amount: toAmount(m[1]), description: cap(d.text),
      category: guessCategory(d.text, categories), date: d.date };
  }

  m = new RegExp(`^(?:earned|received|got paid|income|cobr[eé]|recib[ií]|gan[eé])\\s+${NUM}\\s*([\\s\\S]*)$`, "i").exec(text);
  if (m) {
    const d = extractDay(clean(m[2]), today);
    return { kind: "transaction", txnType: "income", amount: toAmount(m[1]), description: cap(d.text),
      category: guessCategory(d.text, categories), date: d.date };
  }

  m = new RegExp(`^([+-])\\s*${NUM}\\s*([\\s\\S]*)$`).exec(text) ;
  if (m) {
    const d = extractDay(clean(m[3]), today);
    return { kind: "transaction", txnType: m[1] === "+" ? "income" : "expense", amount: toAmount(m[2]),
      description: cap(d.text), category: guessCategory(d.text, categories), date: d.date };
  }

  m = new RegExp(`^\\$\\s*(\\d{1,7}(?:[.,]\\d{1,2})?)\\s+([\\s\\S]+)$|^(\\d{1,7}(?:[.,]\\d{1,2})?)\\s*(?:usd|\\$)\\s+([\\s\\S]+)$`, "i").exec(text);
  if (m) {
    const amount = m[1] ?? m[3];
    const rest = m[2] ?? m[4];
    const d = extractDay(clean(rest), today);
    return { kind: "transaction", txnType: "expense", amount: toAmount(amount), description: cap(d.text),
      category: guessCategory(d.text, categories), date: d.date };
  }

  return null;
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Validates the JSON Claude returns; null if it does not look right. */
export function validateParsed(o: unknown): Parsed | null {
  if (!o || typeof o !== "object") return null;
  const x = o as Record<string, unknown>;
  if (x.kind === "task" && typeof x.title === "string" && x.title.trim()) {
    return { kind: "task", title: x.title.trim().slice(0, 300), date: isDate(x.date) ? x.date : null };
  }
  if (x.kind === "note" && typeof x.title === "string") {
    return { kind: "note", title: x.title.trim().slice(0, 200) || "Note", content: typeof x.content === "string" ? x.content : "" };
  }
  if (x.kind === "transfer" && typeof x.from === "string" && typeof x.to === "string") {
    const amount = Number(x.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return null;
    return { kind: "transfer", amount: Math.round(amount * 100) / 100, from: x.from, to: x.to, date: isDate(x.date) ? x.date : null };
  }
  if (x.kind === "transaction" && (x.txnType === "income" || x.txnType === "expense")) {
    const amount = Number(x.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return null;
    return {
      kind: "transaction",
      txnType: x.txnType,
      amount: Math.round(amount * 100) / 100,
      description: typeof x.description === "string" ? x.description.slice(0, 300) : "",
      category: typeof x.category === "string" && x.category ? x.category : null,
      date: isDate(x.date) ? x.date : null,
    };
  }
  return null;
}

/** What the AI is told: one message → one JSON item. */
function aiSystem(today: string, categories: string[], accounts: string[]) {
  return [
    `Today is ${today}. You turn one short personal message (English or Spanish) into ONE JSON object and nothing else.`,
    `Shapes: {"kind":"task","title":string,"date":"YYYY-MM-DD"|null}`,
    `| {"kind":"note","title":string,"content":string}`,
    `| {"kind":"transaction","txnType":"expense"|"income","amount":number,"description":string,"category":string|null,"date":"YYYY-MM-DD"|null}`,
    `| {"kind":"transfer","amount":number,"from":string,"to":string,"date":"YYYY-MM-DD"|null}.`,
    `Amounts are USD. category must be one of: ${categories.length ? categories.join(", ") : "(none)"} or null.`,
    `The user's accounts: ${accounts.length ? accounts.join(", ") : "(none)"}. A transfer moves money between two of them (use their names).`,
    `Things to do are tasks (title short, in the user's language, without the date words); money spent or received are transactions`,
    `(description = what it was for, without the amount, date or account); ideas, thoughts and longer text are notes.`,
    `Relative dates ("mañana", "ayer", "el viernes", "next monday") become YYYY-MM-DD; no date = null.`,
  ].join("\n");
}

/** Ask the AI to classify the message. Returns null on any problem (caller falls back to rules). */
export async function aiParse(text: string, today: string, categories: string[], accounts: string[] = []): Promise<Parsed | null> {
  const system = aiSystem(today, categories, accounts);
  if (hasGemini()) {
    const out = await geminiJson(system, [{ text: text.slice(0, 2000) }]);
    const parsed = validateParsed(out);
    if (parsed) return parsed;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: text.slice(0, 2000) }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = json.content?.find((c) => c.type === "text")?.text ?? "";
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return validateParsed(JSON.parse(out.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export function describe(p: Parsed) {
  if (p.kind === "transfer") {
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p.amount);
    return `Transfer: ${money} · ${p.from} → ${p.to}${p.date ? ` (${p.date})` : ""}`;
  }
  if (p.kind === "task") return `Task: ${p.title}${p.date ? ` (${p.date})` : ""}`;
  if (p.kind === "note") return `Note: ${p.title}`;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p.amount);
  return `${p.txnType === "income" ? "Income" : "Expense"}: ${money}${p.description ? ` · ${p.description}` : ""}${p.category ? ` · ${p.category}` : ""}${p.date ? ` (${p.date})` : ""}`;
}
