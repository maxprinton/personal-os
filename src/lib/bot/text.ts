// Pure text helpers for the Telegram bot (no database, no network): command words, amounts,
// dates, times and "noise" (ok, gracias…). Everything here is covered by scripts/test-bot.ts.
import { addDays, isoWeekday } from "@/lib/time";

/** One character at a time, so indexes stay the same as in the original text. */
export function fold(s: string) {
  return [...s.normalize("NFC")].map((ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "")).join("").toLowerCase();
}

/**
 * A command as typed or tapped: no accents, lower case, no leading emoji ("📅 Today"), no ¿?¡!.,
 * no "@botname", single spaces.
 */
export function norm(text: string) {
  return fold(text.trim())
    .replace(/@\w+/g, "")
    .replace(/^[^\p{L}\p{N}/]+/u, "")
    .replace(/[¿?¡!.,;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The whole message is one of these words (after norm). */
export function isOneOf(text: string, words: string[]) {
  return words.includes(norm(text));
}

/**
 * "/buscar gym", "buscar gym", "search gym" → "gym" (original casing). "" when only the command was
 * sent, null when the message does not start with one of the names.
 */
export function commandArg(text: string, names: string[]): string | null {
  const original = text.trim().replace(/^[^\p{L}\p{N}/]+/u, "");
  const tokens = original.split(/\s+/);
  const folded = tokens.map((t) => norm(t));
  for (const name of names) {
    const parts = name.split(" ");
    if (parts.every((p, i) => folded[i] === p)) return tokens.slice(parts.length).join(" ").trim();
  }
  return null;
}

// ---- Amounts ----------------------------------------------------------------------

/**
 * One amount, as a capturing group: 12 · 12.50 · 12,5 · 1.500 · 1,500 · 1.234,56 · 1,234.56.
 * A separator followed by exactly 3 digits is a thousands separator (USD has 2 decimals).
 */
export const AMOUNT = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d{1,7}(?:[.,]\d{1,2})?(?!\d))`;

export function toAmount(raw: string) {
  const s = raw.replace(/\s/g, "");
  const m = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(s);
  const n = m ? Number(m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "")) : Number(s.replace(",", "."));
  return Math.round(n * 100) / 100;
}

/** A message that is only an amount ("15", "$15.50", "15 usd"), or null. */
export function onlyAmount(text: string): number | null {
  const m = new RegExp(`^\\s*\\$?\\s*${AMOUNT}\\s*(?:usd|\\$)?\\s*$`, "i").exec(text);
  if (!m) return null;
  const n = toAmount(m[1]);
  return n > 0 ? n : null;
}

/** The first amount anywhere in a text (and the text without it). */
export function findAmount(text: string): { amount: number; rest: string } | null {
  const m = new RegExp(`(?:^|\\s)\\$?\\s*${AMOUNT}\\s*(?:usd|dolares|dólares|\\$)?(?=\\s|$)`, "i").exec(text);
  if (!m) return null;
  const amount = toAmount(m[1]);
  if (!(amount > 0)) return null;
  return { amount, rest: clean(text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)) };
}

const clean = (s: string) => s.replace(/\s{2,}/g, " ").trim();

// ---- Dates ------------------------------------------------------------------------

const WEEKDAY: Record<string, number> = {
  lunes: 1, monday: 1, martes: 2, tuesday: 2, miercoles: 3, wednesday: 3, jueves: 4, thursday: 4,
  viernes: 5, friday: 5, sabado: 6, saturday: 6, domingo: 7, sunday: 7,
};
const MONTH: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4, mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, september: 9,
  octubre: 10, oct: 10, october: 10, noviembre: 11, nov: 11, november: 11, diciembre: 12, dic: 12, december: 12, dec: 12,
};
const WD = Object.keys(WEEKDAY).join("|");
const MO = Object.keys(MONTH).sort((a, b) => b.length - a.length).join("|");

/** future = tasks, events, payments ("el viernes" = the next one); past = money ("el viernes" = the last one). */
export type DateMode = "future" | "past";

function ymd(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A day and month without a year: this year, or the next/previous one so it is on the right side of today. */
function withYear(m: number, d: number, today: string, mode: DateMode) {
  const y = Number(today.slice(0, 4));
  const here = ymd(y, m, d);
  if (!here) return ymd(y + (mode === "future" ? 1 : -1), m, d);
  if (mode === "future" && here < today) return ymd(y + 1, m, d);
  if (mode === "past" && here > today) return ymd(y - 1, m, d);
  return here;
}

/** "el 5": day of this month, or of the next/previous month. */
function dayOfMonth(d: number, today: string, mode: DateMode) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 3; i++) {
    const here = ymd(y, m, d);
    if (here && (mode === "future" ? here >= today : here <= today)) return here;
    m += mode === "future" ? 1 : -1;
    if (m === 13) { m = 1; y++; }
    if (m === 0) { m = 12; y--; }
  }
  return null;
}

type Rule = { re: RegExp; date: (m: RegExpExecArray, today: string, mode: DateMode) => string | null };

// Words before "mañana" that make it "the morning", not "tomorrow": "por la mañana", "esta mañana"…
const MORNING_BEFORE = /(?:^|\s)(?:la|las|esta|cada|toda|una|media)\s+$/;

const RULES: Rule[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, date: (m) => ymd(+m[1], +m[2], +m[3]) },
  {
    re: /\b(?:el\s+|on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
    date: (m, t, mode) => (m[3] ? ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) : withYear(+m[2], +m[1], t, mode)),
  },
  {
    re: new RegExp(String.raw`\b(?:el\s+|on\s+|del\s+)?(\d{1,2})\s+(?:de\s+)?(${MO})\b(?:\s+(?:de\s+)?(\d{4}))?`),
    date: (m, t, mode) => (m[3] ? ymd(+m[3], MONTH[m[2]], +m[1]) : withYear(MONTH[m[2]], +m[1], t, mode)),
  },
  {
    re: new RegExp(String.raw`\b(?:on\s+)?(${MO})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`),
    date: (m, t, mode) => (m[3] ? ymd(+m[3], MONTH[m[1]], +m[2]) : withYear(MONTH[m[1]], +m[2], t, mode)),
  },
  { re: /\b(?:pasado\s+manana|day\s+after\s+tomorrow)\b/, date: (_m, t) => addDays(t, 2) },
  { re: /\b(?:anteayer|antier|antes\s+de\s+ayer)\b/, date: (_m, t) => addDays(t, -2) },
  { re: /\b(?:tomorrow|manana)\b/, date: (_m, t) => addDays(t, 1) },
  { re: /\b(?:yesterday|ayer)\b/, date: (_m, t) => addDays(t, -1) },
  { re: /\b(?:today|hoy)\b/, date: (_m, t) => t },
  {
    re: /\b(?:in|en|dentro\s+de)\s+(\d{1,2})\s+(?:days?|dias?)\b/,
    date: (m, t) => addDays(t, +m[1]),
  },
  {
    re: new RegExp(String.raw`\b(?:(next|proximo|el\s+proximo|this|este|el|on|last|pasado|el\s+pasado)\s+)?(${WD})\b(?:\s+(que\s+viene|proximo|pasado))?`),
    date: (m, t, mode) => {
      const target = WEEKDAY[m[2]];
      const now = isoWeekday(t);
      const pre = (m[1] ?? "").replace(/^el\s+/, "");
      const post = m[3] ?? "";
      const forward = (target - now + 7) % 7;
      const back = (now - target + 7) % 7;
      if (pre === "next" || pre === "proximo" || post === "que viene" || post === "proximo") return addDays(t, forward === 0 ? 7 : forward);
      if (pre === "last" || pre === "pasado" || post === "pasado") return addDays(t, back === 0 ? -7 : -back);
      return mode === "future" ? addDays(t, forward) : addDays(t, -back);
    },
  },
  { re: /\b(?:el|the)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?::|h\b|am\b|pm\b))/, date: (m, t, mode) => (+m[1] >= 1 && +m[1] <= 31 ? dayOfMonth(+m[1], t, mode) : null) },
];

/**
 * Finds a date in free text ("mañana", "el viernes", "5 nov", "12/11", "2026-11-05", "en 3 días"…).
 * Returns the date and the text without those words, or null. "por la mañana" is not a date.
 */
export function findDate(text: string, today: string, mode: DateMode = "future"): { date: string; rest: string } | null {
  const f = fold(text);
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(f))) {
      if (/manana/.test(m[0]) && !/pasado/.test(m[0]) && MORNING_BEFORE.test(f.slice(0, m.index))) continue;
      const date = rule.date(m, today, mode);
      if (!date) continue;
      return { date, rest: clean(text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/^(?:para|for|el|on)\s+$/i, "") };
    }
  }
  return null;
}

/** A message that is only a date ("viernes", "5 nov", "mañana"), or null. */
export function onlyDate(text: string, today: string, mode: DateMode = "future") {
  const hit = findDate(text, today, mode);
  if (!hit) return null;
  return /^(?:para|for|el|on|the|a|to|al)?$/i.test(hit.rest.trim()) ? hit.date : null;
}

// ---- Times ------------------------------------------------------------------------

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const TM = String.raw`(\d{1,2})(?::(\d{2})|(h)(\d{2})?)?(?:\s*(a\.?m\.?|p\.?m\.?))?`;
const PART = String.raw`(?:\s+de\s+la\s+(manana|tarde|noche))?`;

type Piece = { h: number; m: number; ap: string; explicit: boolean };
function piece(g: (string | undefined)[], i: number): Piece {
  const ap = (g[i + 4] ?? "").replace(/\./g, "");
  return { h: Number(g[i]), m: Number(g[i + 1] ?? g[i + 3] ?? 0), ap, explicit: g[i + 1] !== undefined || g[i + 2] !== undefined || Boolean(ap) };
}
function finish(p: Piece, ap: string, part: string | undefined, guessPm: boolean): string | null {
  let h = p.h;
  if (p.m > 59 || h > 24) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && part) {
    if ((part === "tarde" || part === "noche") && h < 12) h += 12;
    if (part === "manana" && h === 12) h = 0;
  }
  if (!ap && !part && guessPm && h >= 1 && h <= 6) h += 12;
  if (h === 24) h = 0;
  return hhmm(h, p.m);
}

/**
 * Finds a time or a range: "15:00", "3pm", "3:30 pm", "15h", "a las 3 de la tarde", "10:00-11:30",
 * "de 3 a 5 pm" (needs am/pm, a colon or "h" somewhere), "a las 3" (1–6 without am/pm = afternoon).
 * A bare number is never a time.
 */
export function findTime(text: string): { start: string; end: string | null; rest: string } | null {
  const f = fold(text);
  const cut = (index: number, len: number) => clean(text.slice(0, index) + " " + text.slice(index + len));
  const range = new RegExp(
    String.raw`(\ba\s+las?\s+|\bfrom\s+|\bdesde\s+(?:las?\s+)?|\bde\s+)?\b${TM}\s*(?:-|–|\ba\b|\bto\b|\bhasta\b)\s*(?:las?\s+)?${TM}${PART}`
  ).exec(f);
  if (range) {
    const a = piece(range, 2);
    const b = piece(range, 7);
    const part = range[12];
    const lead = (range[1] ?? "").trim();
    if (a.explicit || b.explicit || part || (lead && lead !== "de")) {
      const apB = b.ap;
      const apA = a.ap || (apB && a.h <= b.h ? apB : "");
      const guess = Boolean(lead && lead !== "de");
      const start = finish(a, apA, part, guess);
      const end = finish(b, apB, part, guess);
      if (start && end) return { start, end, rest: cut(range.index, range[0].length) };
    }
  }
  const single = new RegExp(String.raw`(\ba\s+las?\s+|\bat\s+)?\b${TM}${PART}`, "g");
  let m: RegExpExecArray | null;
  while ((m = single.exec(f))) {
    const p = piece(m, 2);
    const lead = Boolean(m[1]);
    if (!lead && !p.explicit && !m[7]) continue;
    const start = finish(p, p.ap, m[7], lead);
    if (!start) continue;
    return { start, end: null, rest: cut(m.index, m[0].length) };
  }
  return null;
}

/** Adds minutes to "HH:MM" (wraps past midnight). */
export function plusMinutes(t: string, minutes: number) {
  const [h, m] = t.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return hhmm(Math.floor(total / 60), total % 60);
}

// ---- Noise ------------------------------------------------------------------------

const NOISE = new Set([
  "ok", "okay", "oki", "okey", "vale", "listo", "dale", "bueno", "bien", "perfecto", "genial", "excelente", "cool", "nice",
  "gracias", "muchas gracias", "thanks", "thank you", "thx", "ty", "hola", "hi", "hello", "hey", "buenas", "buenos dias",
  "buenas tardes", "buenas noches", "good morning", "good night", "chao", "bye", "adios", "jaja", "jajaja", "jajajaja",
  "jeje", "lol", "si", "no", "yes", "nop", "nope", "sip", "ya", "mmm", "hmm", "uff", "wow", "test", "prueba",
]);

/** Greetings, thanks, "ok", emoji only… : never saved as a task or note. */
export function isNoise(text: string) {
  const t = fold(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (NOISE.has(t)) return true;
  if (/^(?:ja|je|ha|he)+$/.test(t.replace(/\s/g, ""))) return true;
  return t.replace(/\s/g, "").length < 3 && !/\d/.test(t);
}

/** Lower case, no accents, single spaces (for matching names). */
export function simplify(s: string) {
  return fold(s).replace(/\s+/g, " ").trim();
}

/** Best matches for a name: exact, then starts with, then contains (accents and case ignored). */
export function bestMatches<T>(items: T[], query: string, name: (x: T) => string): T[] {
  const q = simplify(query);
  if (!q) return [];
  for (const test of [(n: string) => n === q, (n: string) => n.startsWith(q), (n: string) => n.includes(q)]) {
    const found = items.filter((i) => test(simplify(name(i))));
    if (found.length) return found;
  }
  return [];
}

/** "Fri Oct 31" */
export function shortDay(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** YYYY-MM-DD <-> YYYYMMDD (8 characters, for buttons). */
export const packDate = (d: string) => d.replace(/-/g, "");
export const unpackDate = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** "Fri 31" */
export function wdDay(d: string) {
  const wd = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${Number(d.slice(8, 10))}`;
}

/**
 * A range of days: "del 2 al 5 de nov", "2-5 nov", "nov 2-5", "de lunes a viernes", "mañana a domingo".
 * Returns from/to and the text without them, or null.
 */
export function findRange(text: string, today: string): { from: string; to: string; rest: string } | null {
  const f = fold(text);
  const sameMonth = new RegExp(String.raw`\b(?:del?\s+|from\s+)?(\d{1,2})\s*(?:-|–|al|a|to|hasta)\s*(\d{1,2})\s+(?:de\s+)?(${MO})\b(?:\s+(?:de\s+)?(\d{4}))?`).exec(f);
  if (sameMonth) {
    const mo = MONTH[sameMonth[3]];
    const from = sameMonth[4] ? ymd(+sameMonth[4], mo, +sameMonth[1]) : withYear(mo, +sameMonth[1], today, "future");
    const to = from ? ymd(Number(from.slice(0, 4)), mo, +sameMonth[2]) : null;
    if (from && to && to >= from) return { from, to, rest: clean(text.slice(0, sameMonth.index) + " " + text.slice(sameMonth.index + sameMonth[0].length)) };
  }
  const monthFirst = new RegExp(String.raw`\b(${MO})\s+(\d{1,2})\s*(?:-|–|to|al|a)\s*(\d{1,2})\b`).exec(f);
  if (monthFirst) {
    const mo = MONTH[monthFirst[1]];
    const from = withYear(mo, +monthFirst[2], today, "future");
    const to = from ? ymd(Number(from.slice(0, 4)), mo, +monthFirst[3]) : null;
    if (from && to && to >= from) return { from, to, rest: clean(text.slice(0, monthFirst.index) + " " + text.slice(monthFirst.index + monthFirst[0].length)) };
  }
  // Two dates joined by al / a / hasta / to / until / -
  const joiner = /\s+(?:al|a|hasta|to|until|-|–)\s+/g;
  let j: RegExpExecArray | null;
  while ((j = joiner.exec(f))) {
    const left = text.slice(0, j.index);
    const right = text.slice(j.index + j[0].length);
    const b = findDate(right, today, "future");
    if (!b) continue;
    // "del 2 al 5 de nov": a bare day number before the joiner takes the month of the second date
    const bare = /(?:^|\s)(?:del?\s+|from\s+|desde\s+(?:el\s+)?)?(\d{1,2})\s*$/.exec(fold(left));
    let from: string | null = null;
    let leftRest = left;
    if (bare) {
      from = ymd(Number(b.date.slice(0, 4)), Number(b.date.slice(5, 7)), Number(bare[1]));
      leftRest = left.slice(0, bare.index);
    } else {
      const a = findDate(left, today, "future");
      if (a) {
        from = a.date;
        leftRest = a.rest.replace(/(?:^|\s)(?:del?|from|desde)\s*$/i, "");
      }
    }
    if (!from) continue;
    let to = b.date;
    // "de lunes a viernes" on a Wednesday: next Monday to the Friday after it
    if (to < from && new RegExp(`\\b(?:${WD})\\b`).test(fold(right))) to = addDays(to, 7);
    if (to < from) continue;
    return { from, to, rest: clean(`${leftRest} ${b.rest}`) };
  }
  return null;
}
