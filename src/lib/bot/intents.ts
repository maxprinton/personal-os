// Pure parsers for the bot's action messages (no database): events, scheduled payments, free days,
// block notes, real balances and metrics. Covered by scripts/test-bot.ts.
import { AMOUNT, findAmount, findDate, findRange, findTime, fold, plusMinutes, simplify, toAmount } from "@/lib/bot/text";
import { addDays } from "@/lib/time";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tidy = (s: string) =>
  s
    .replace(/\s{2,}/g, " ")
    .replace(/^(?:(?:el|la|a|al|on|at|for|para|de|del|en|con|y|-|,|·)\s+)+/i, "")
    .replace(/(?:\s+(?:el|la|a|al|on|at|for|para|de|del|en|con|y|-|,|·))+$/i, "")
    .trim();

// ---- Events ----------------------------------------------------------------------------

export type EventCmd = { title: string; date: string; endDate: string; start: string | null; end: string | null };

/** "evento: dentista viernes 15:00", "event: trip 2-5 nov", "cita: médico mañana a las 3 de la tarde" */
export function parseEventCmd(text: string, today: string): EventCmd | { error: string } | null {
  const m = /^(?:evento|event|ev|cita|appointment|appt)\s*:\s*([\s\S]+)$/i.exec(text.trim());
  if (!m) return null;
  let body = m[1].trim();
  const time = findTime(body);
  if (time) body = time.rest;
  let date = today;
  let endDate = today;
  const range = findRange(body, today);
  if (range) {
    date = range.from;
    endDate = range.to;
    body = range.rest;
  } else {
    const d = findDate(body, today, "future");
    if (d) {
      date = d.date;
      endDate = d.date;
      body = d.rest;
    }
  }
  const title = cap(tidy(body));
  if (!title) return { error: "Give the event a name, e.g. “event: dentist friday 3pm”." };
  if (!time) return { title, date, endDate, start: null, end: null };
  const end = time.end ?? plusMinutes(time.start, 60);
  // An end earlier than the start = it ends the next day (only for one-day events)
  if (endDate === date && end <= time.start) endDate = addDays(date, 1);
  return { title, date, endDate, start: time.start, end };
}

// ---- Scheduled payments ------------------------------------------------------------------

export type RepeatUnit = "none" | "days" | "weeks" | "months" | "years";
export type PaymentCmd = {
  type: "expense" | "income";
  name: string;
  amount: number | null;
  unit: RepeatUnit;
  every: number;
  start: string;
  /** The text left after the name, amount, date and repeat words (to find the account). */
  rest: string;
};

const UNIT: Record<string, RepeatUnit> = {
  dia: "days", dias: "days", day: "days", days: "days",
  semana: "weeks", semanas: "weeks", week: "weeks", weeks: "weeks",
  mes: "months", meses: "months", month: "months", months: "months",
  ano: "years", anos: "years", year: "years", years: "years",
};

/** "pago: luz 25 cada mes el 5", "payment: rent 500 monthly on the 1st", "cobro: sueldo 1500 cada 15 días" */
export function parsePaymentCmd(text: string, today: string): PaymentCmd | { error: string } | null {
  const m = /^(pago fijo|pago|payment|bill|cobro fijo|cobro|income)\s*:\s*([\s\S]+)$/i.exec(text.trim());
  if (!m) return null;
  const type = /cobro|income/i.test(m[1]) ? "income" : "expense";
  let body = m[2].trim();
  let unit: RepeatUnit = "none";
  let every = 1;
  const cut = (index: number, len: number) => {
    body = (body.slice(0, index) + " " + body.slice(index + len)).replace(/\s{2,}/g, " ").trim();
  };
  const f = () => fold(body);
  const n = /\b(?:cada|every)\s+(\d{1,3})\s+(dias?|days?|semanas?|weeks?|mes(?:es)?|months?|anos?|years?)\b/.exec(f());
  if (n) {
    unit = UNIT[n[2]] ?? "none";
    every = Math.max(1, Math.min(366, Number(n[1])));
    cut(n.index, n[0].length);
  } else {
    const words: [RegExp, RepeatUnit][] = [
      [/\b(?:de\s+cada\s+mes|cada\s+mes|mensual(?:mente)?|monthly|every\s+month|al\s+mes|por\s+mes)\b/, "months"],
      [/\b(?:cada\s+semana|semanal(?:mente)?|weekly|every\s+week|por\s+semana)\b/, "weeks"],
      [/\b(?:de\s+cada\s+ano|cada\s+ano|anual(?:mente)?|yearly|annually|every\s+year|al\s+ano|por\s+ano)\b/, "years"],
      [/\b(?:cada\s+dia|diario|diariamente|daily|every\s+day|todos\s+los\s+dias)\b/, "days"],
    ];
    for (const [re, u] of words) {
      const w = re.exec(f());
      if (w) {
        unit = u;
        cut(w.index, w[0].length);
        break;
      }
    }
  }
  let start = today;
  const d = findDate(body, today, "future");
  if (d) {
    start = d.date;
    body = d.rest;
  }
  let amount: number | null = null;
  const a = findAmount(body);
  if (a) {
    amount = a.amount;
    body = a.rest;
  }
  const name = cap(tidy(body));
  if (!name) return { error: "Name the payment, e.g. “payment: internet 32 monthly on the 10th”." };
  return { type, name, amount, unit, every, start, rest: body };
}

export function describeRepeat(unit: RepeatUnit, every: number) {
  if (unit === "none") return "one time";
  const word = { days: "day", weeks: "week", months: "month", years: "year" }[unit];
  return every === 1 ? `every ${word}` : `every ${every} ${word}s`;
}

// ---- Free days ------------------------------------------------------------------------

export type FreeDayCmd = { from: string; to: string; note: string | null };

/** "libre mañana", "día libre 2-5 nov viaje", "free day friday", "libre" (= today) */
export function parseFreeDayCmd(text: string, today: string): FreeDayCmd | null {
  const m = /^(?:d[ií]as?\s+libres?|libre|free\s+days?|day\s+off|days\s+off)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const body = (m[1] ?? "").trim();
  if (!body) return { from: today, to: today, note: null };
  const range = findRange(body, today);
  if (range) return { from: range.from, to: range.to, note: tidy(range.rest) || null };
  const d = findDate(body, today, "future");
  if (!d) return null; // "libre de gluten…" is not a free day
  return { from: d.date, to: d.date, note: tidy(d.rest) || null };
}

// ---- Block notes ------------------------------------------------------------------------

/** "nb: text" (the block of right now) or "nb Gym: text". "[] text" becomes a checkbox. */
export function parseBlockNoteCmd(text: string): { block: string | null; body: string } | null {
  const m = /^nb(?:\s+([^:\n]{1,60}?))?\s*:\s*([\s\S]+)$/i.exec(text.trim());
  if (!m) return null;
  const body = m[2]
    .split("\n")
    .map((l) => l.replace(/^\s*\[\s?\]\s*/, "- [ ] ").replace(/^\s*\[x\]\s*/i, "- [x] "))
    .join("\n")
    .trim();
  return body ? { block: m[1]?.trim() || null, body } : null;
}

// ---- Real balance ---------------------------------------------------------------------------

/** "saldo pichincha 1234,50", "balance visa 300", "saldo real efectivo = 45" */
export function parseSetBalanceCmd(text: string): { account: string; amount: number } | null {
  const m = new RegExp(String.raw`^(?:saldo\s+real|saldo|real\s+balance|balance)\s+(.+?)\s+(?:es\s+|is\s+|=\s*|:\s*)?(-?)\$?\s*${AMOUNT}\s*(?:usd)?$`, "i").exec(text.trim());
  if (!m) return null;
  const amount = toAmount(m[3]) * (m[2] === "-" ? -1 : 1);
  return Number.isFinite(amount) ? { account: m[1].replace(/\s*(?:de|del|en)\s*$/i, "").trim(), amount } : null;
}

// ---- Metrics ------------------------------------------------------------------------------

/** "sueño 7.5", "agua +1", "ánimo: 8", "weight 78,2 kg" — only for names of metrics you have. */
export function parseMetricCmd(text: string, names: string[]): { name: string; value: number; add: boolean } | null {
  const t = text.trim();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const f = fold(t);
    const n = simplify(name);
    if (!f.startsWith(n)) continue;
    const rest = t.slice(name.length).trim();
    const m = new RegExp(String.raw`^:?\s*(\+)?\s*(-?\d{1,6}(?:[.,]\d{1,3})?)\s*[\p{L}%°/]{0,6}$`, "u").exec(rest);
    if (!m) continue;
    const value = Number(m[2].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    return { name, value, add: Boolean(m[1]) };
  }
  return null;
}
