// Reads the class table you copy out of Notion (pasted cells = tab-separated, or an exported CSV) into work-log rows.
// Pure: no database. Understands "Oct 27 9:00 PM → 10:00 PM", "October 27, 2026 9:00 PM (GMT-5) → 10:00 PM (GMT-5)",
// "2026-10-27 21:00 → 22:00" and Spanish months ("27 de octubre de 2026 9:00 PM → 10:00 PM").
import { calcHours, hhmm, isHttpUrl } from "@/lib/work-log";

export type ImportRow = {
  class_date: string;
  start_time: string; // HH:MM
  end_time: string;
  group_name: string;
  hours: number;
  /** $ per hour when the table has a money column; null → use your default rate. */
  rate: number | null;
  video_url: string | null;
  /** Text in parentheses after the class name ("B2-7 (RECUPERADO SAB 5 9AM)") goes here. */
  notes: string | null;
  line: number; // 1-based line in the pasted text (for error messages)
};

export type ImportError = { line: number; text: string; reason: string };
export type ImportResult = { rows: ImportRow[]; errors: ImportError[]; hasHeader: boolean };

const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  enero: 1, ene: 1, febrero: 2, marzo: 3, abril: 4, abr: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, set: 9, octubre: 10, noviembre: 11, diciembre: 12, dic: 12,
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");

/** Splits pasted text into rows of cells. Tabs if the first line has one, otherwise commas; "quoted, cells" and line breaks inside quotes work. */
export function splitDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const sep = first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const push = () => {
    row.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    push();
    rows.push(row);
  }
  return rows;
}

function realDate(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Finds a date in a piece of text. Without a year it uses this year (or last year when that would be more than 45 days ahead). */
export function findDate(s: string, today: string): string | null {
  const [ty, tm, td] = today.split("-").map(Number);
  const withYear = (m: number, d: number, y?: number) => {
    let year = y ?? ty;
    if (y === undefined && Date.UTC(year, m - 1, d) > Date.UTC(ty, tm - 1, td) + 45 * 86400000) year--;
    return realDate(year, m, d) ? `${year}-${pad(m)}-${pad(d)}` : null;
  };
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return realDate(+iso[1], +iso[2], +iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  const slash = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (slash) {
    let a = +slash[1];
    let b = +slash[2];
    if (a > 12) [a, b] = [b, a]; // 27/10/2026 is day/month
    return withYear(a, b, +slash[3]);
  }
  const f = fold(s);
  let m: RegExpExecArray | null;
  const monthFirst = /([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/g; // Oct 27 · October 27, 2026
  while ((m = monthFirst.exec(f))) {
    const mo = MONTH_WORDS[m[1]];
    if (mo) return withYear(mo, +m[2], m[3] ? +m[3] : undefined);
  }
  const dayFirst = /(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?(?:\s+(?:de\s+)?(\d{4}))?/g; // 27 Oct 2026 · 27 de octubre de 2026
  while ((m = dayFirst.exec(f))) {
    const mo = MONTH_WORDS[m[2]];
    if (mo) return withYear(mo, +m[1], m[3] ? +m[3] : undefined);
  }
  return null;
}

/** Every clock time in a piece of text, in order, as HH:MM. */
export function findTimes(s: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b|\b(\d{1,2}):(\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let h: number;
    let min: number;
    if (m[3]) {
      h = +m[1];
      min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12) continue;
      h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    } else {
      h = +m[4];
      min = +m[5];
    }
    if (h > 23 || min > 59) continue;
    out.push(`${pad(h)}:${pad(min)}`);
  }
  return out;
}

const cleanWhen = (s: string) =>
  s.replace(/\(?\s*(?:GMT|UTC)\s*[+-]?\d{0,2}(?::?\d{2})?\s*\)?/gi, " ").replace(/@/g, " ").replace(/\s+/g, " ").trim();

/** "Oct 27 9:00 PM → 10:00 PM" → date + start + end. */
export function parseWhen(raw: string, today: string): { date: string; start: string; end: string } | { error: string } {
  const text = cleanWhen(raw);
  if (!text) return { error: "No date and time" };
  const parts = text.split(/\s*(?:→|->|—|–)\s*/);
  const date = findDate(parts[0], today);
  if (!date) return { error: "Couldn't read the date" };
  const left = findTimes(parts[0]);
  const right = parts[1] ? findTimes(parts[1]) : [];
  const start = left[0];
  const end = parts.length > 1 ? right[0] : left[1];
  if (!start) return { error: "Couldn't read the start time" };
  if (!end) return { error: "Couldn't read the end time" };
  if (start === end) return { error: "Start and end time are the same" };
  return { date, start, end };
}

const HEADERS: Record<"group" | "when" | "url" | "hours" | "money", string[]> = {
  group: ["clase", "class", "grupo", "group", "name", "nombre"],
  when: ["horario", "schedule", "fecha", "date", "when"],
  url: ["url", "video", "link", "enlace", "evidencia"],
  hours: ["horas", "hours", "hora"],
  money: ["dinero", "money", "pay", "pago", "amount", "monto"],
};

/** "6", "$6.00", "1,5" → number. Anything else (a link, "attachment:…") → null. */
const num = (s: string | undefined) => {
  const t = String(s ?? "").trim().replace(/^\$\s*/, "").replace(/\s*(?:usd|\$)$/i, "");
  return /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : null;
};

/** "B2-7 (RECUPERADO SAB 5 9AM)" → class "B2-7" + note "RECUPERADO SAB 5 9AM". */
export function splitGroup(raw: string): { group: string; notes: string | null } {
  const g = raw.replace(/\s+/g, " ").trim();
  const m = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(g);
  return m && m[1].trim() ? { group: m[1].trim(), notes: m[2].trim() } : { group: g, notes: null };
}

export function parseNotionTable(text: string, today: string): ImportResult {
  const table = splitDelimited(text.replace(/^﻿/, ""));
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  if (!table.length) return { rows, errors, hasHeader: false };

  // Which column is which: by header name when there is a header row, otherwise Notion's order (Clase, Horario, URL, Horas, Dinero)
  const head = table[0].map((c) => fold(c).trim());
  const find = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const hasHeader = find("group") >= 0 || find("when") >= 0;
  // Without a header, the columns after Clase and Horario are read by what they contain: a link = the video, plain numbers =
  // hours then money, anything else (attendance images "attachment:…", Concat…) is ignored. So a table with or without the URL
  // column works.
  const col = hasHeader
    ? { group: find("group"), when: find("when"), url: find("url"), hours: find("hours"), money: find("money") }
    : { group: 0, when: 1, url: -1, hours: -1, money: -1 };
  if (col.group < 0 || col.when < 0) {
    return { rows, errors: [{ line: 1, text: table[0].join(" | ").slice(0, 80), reason: "I need a “Clase” column and a “Horario” column" }], hasHeader };
  }

  table.forEach((cells, i) => {
    if (hasHeader && i === 0) return;
    if (cells.every((c) => !c.trim())) return;
    const line = i + 1;
    const shown = cells.join(" | ").slice(0, 80);
    const { group, notes } = splitGroup(cells[col.group] ?? "");
    if (!group) return void errors.push({ line, text: shown, reason: "No class name" });
    const when = parseWhen(cells[col.when] ?? "", today);
    if ("error" in when) return void errors.push({ line, text: shown, reason: when.error });
    const computed = calcHours(when.start, when.end);
    if (computed <= 0 || computed > 12) return void errors.push({ line, text: shown, reason: "The class length looks wrong" });
    let hoursCol: number | null;
    let money: number | null;
    let url: string;
    if (hasHeader) {
      hoursCol = col.hours >= 0 ? num(cells[col.hours]) : null;
      money = col.money >= 0 ? num(cells[col.money]) : null;
      url = col.url >= 0 ? (cells[col.url] ?? "").trim() : "";
    } else {
      const nums: number[] = [];
      url = "";
      for (const raw of cells.slice(2)) {
        const c = raw.trim();
        if (/^https?:\/\//i.test(c)) url = url || c;
        else {
          const n = num(c);
          if (n !== null) nums.push(n);
        }
      }
      [hoursCol, money] = [nums[0] ?? null, nums[1] ?? null];
    }
    const per = hoursCol && hoursCol > 0 ? hoursCol : computed;
    rows.push({
      class_date: when.date,
      start_time: hhmm(when.start),
      end_time: hhmm(when.end),
      group_name: group,
      hours: computed,
      rate: money === null ? null : Math.round((money / per) * 100) / 100,
      video_url: isHttpUrl(url) ? url : null,
      notes,
      line,
    });
  });
  return { rows, errors, hasHeader };
}
