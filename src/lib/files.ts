// CSV writing/reading and calendar (.ics) parsing — no dependencies.

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** Parses CSV text (quotes, commas or semicolons) into rows of strings. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export type DateOrder = "ymd" | "mdy" | "dmy";

/** "2026-10-23", "10/23/2026", "23/10/2026", "23-10-26" -> "2026-10-23" (null if invalid). */
export function normalizeDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim().slice(0, 10);
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else {
    const p = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
    if (!p) return null;
    const a = +p[1], b = +p[2];
    y = +p[3] < 100 ? 2000 + +p[3] : +p[3];
    if (order === "dmy") { d = a; m = b; } else { m = a; d = b; }
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1,234.56" / "-12,50" / "$ 45" / "(30.00)" -> number. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[$\s€£]/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else s = s.replace(/,/g, ""); // 1,234.56
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

export type BankRow = { date: string; description: string; amount: number };

/**
 * Bank CSV -> rows. Finds the date / description / amount (or debit + credit) columns by header name.
 * Negative amounts (or debits) become expenses.
 */
export function parseBankCsv(text: string, order: DateOrder): { rows: BankRow[]; skipped: number; error?: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], skipped: 0, error: "The file has no data rows." };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = find("date", "fecha");
  const iDesc = find("description", "descripción", "descripcion", "concept", "concepto", "detail", "detalle", "memo", "payee", "name");
  const iAmount = find("amount", "monto", "importe", "valor");
  const iDebit = find("debit", "débito", "debito", "withdrawal", "cargo");
  const iCredit = find("credit", "crédito", "credito", "deposit", "abono");
  if (iDate < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) {
    return { rows: [], skipped: 0, error: "Could not find Date and Amount columns in the header row." };
  }
  const rows: BankRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const date = normalizeDate(r[iDate] ?? "", order);
    let amount: number | null = null;
    if (iAmount >= 0) amount = parseMoney(r[iAmount] ?? "");
    else {
      const debit = iDebit >= 0 ? parseMoney(r[iDebit] ?? "") : null;
      const credit = iCredit >= 0 ? parseMoney(r[iCredit] ?? "") : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!date || amount === null || amount === 0) { skipped++; continue; }
    rows.push({ date, amount, description: (iDesc >= 0 ? r[iDesc] : "")?.trim().slice(0, 300) ?? "" });
  }
  return { rows, skipped };
}

export type IcsEvent = {
  title: string;
  start: { date: string; time: string | null; utc: boolean; tzid: string | null };
  end: { date: string; time: string | null; utc: boolean; tzid: string | null } | null;
  recurring: boolean;
};

function parseIcsDate(prop: string, value: string) {
  const tzid = /TZID=([^;:]+)/i.exec(prop)?.[1] ?? null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : null,
    utc: Boolean(m[7]),
    tzid,
  };
}

/** Reads VEVENTs from a Google/Apple Calendar .ics export. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/); // unfold
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = { recurring: false };
    else if (line === "END:VEVENT") {
      if (cur?.start) out.push({ title: cur.title || "Untitled event", start: cur.start, end: cur.end ?? null, recurring: Boolean(cur.recurring) });
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const prop = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const name = prop.split(";")[0].toUpperCase();
      if (name === "SUMMARY") cur.title = value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
      else if (name === "DTSTART") cur.start = parseIcsDate(prop, value) ?? undefined;
      else if (name === "DTEND") cur.end = parseIcsDate(prop, value);
      else if (name === "RRULE") cur.recurring = true;
    }
  }
  return out;
}
