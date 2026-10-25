import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockTypes, getFreeDays, getSlots, OCC_COLS } from "@/lib/calendar/model";
import { getHabits } from "@/lib/calendar/habits";
import { userTimezone } from "@/lib/calendar/load";
import { addDays, formatMinutes, ISO_DAY_SHORT, localNow, timeToMinutes } from "@/lib/time";
import { toCsv } from "@/lib/files";
import type { Occurrence, Slot } from "@/lib/calendar/types";

// Downloadable summary of the blocks: when each one happens and how it repeats (CSV, plain text, PDF).

const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AHEAD = 14; // days of one-off changes listed

export type SlotRow = {
  weekday: number;
  start: number; // minutes
  end: number;
  minutes: number; // duration
  nextDay: boolean;
  validFrom: string;
  validTo: string | null;
  startsLater: boolean;
};
export type BlockSummary = { id: string; name: string; color: string; habits: string[]; slots: SlotRow[]; weeklyMinutes: number };
export type Change = { date: string; block: string; kind: "cancelled" | "moved" | "added"; start: number; end: number; from?: string };
export type Summary = {
  today: string;
  timezone: string;
  blocks: BlockSummary[];
  changes: Change[];
  freeDays: { from: string; to: string; note: string | null }[];
};

const span = (a: number, b: number) => (b > a ? b - a : b + 1440 - a);
export const hm = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
export const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const t = (m: number) => formatMinutes(m % 1440);

export async function buildSummary(sb: SupabaseClient, userId: string): Promise<Summary> {
  const timezone = await userTimezone(sb, userId);
  const today = localNow(timezone).date;
  const until = addDays(today, AHEAD - 1);
  const [types, slots, habits, freeDays, occ] = await Promise.all([
    getBlockTypes(sb, userId),
    getSlots(sb, userId, today),
    getHabits(sb, userId),
    getFreeDays(sb, userId, today, until),
    sb
      .from("block_occurrences")
      .select(OCC_COLS)
      .eq("user_id", userId)
      .eq("is_override", true)
      .gte("date", today)
      .lte("date", until)
      .order("date")
      .order("start_time"),
  ]);
  const name = new Map(types.map((x) => [x.id, x.name]));

  const blocks: BlockSummary[] = types.map((bt) => {
    const rows: SlotRow[] = (slots as Slot[])
      .filter((s) => s.block_type_id === bt.id)
      .map((s) => {
        const start = timeToMinutes(s.start_time);
        const end = timeToMinutes(s.end_time);
        return {
          weekday: s.weekday,
          start,
          end,
          minutes: span(start, end),
          nextDay: end < start,
          validFrom: s.valid_from,
          validTo: s.valid_to,
          startsLater: s.valid_from > today,
        };
      })
      .sort((a, b) => a.weekday - b.weekday || a.start - b.start);
    return {
      id: bt.id,
      name: bt.name,
      color: bt.color,
      habits: habits.filter((h) => h.block_type_id === bt.id).map((h) => h.name),
      slots: rows,
      // Hours of a normal week from now on (slots that only start later are not counted)
      weeklyMinutes: rows.filter((r) => !r.startsLater).reduce((s, r) => s + r.minutes, 0),
    };
  });
  blocks.sort((a, b) => b.weeklyMinutes - a.weeklyMinutes || a.name.localeCompare(b.name));

  const changes: Change[] = ((occ.data ?? []) as Occurrence[]).map((o) => ({
    date: o.date,
    block: name.get(o.block_type_id) ?? "Block",
    kind: o.status === "cancelled" ? "cancelled" : o.origin_date && o.origin_date !== o.date ? "moved" : o.slot_id ? "moved" : "added",
    start: timeToMinutes(o.start_time),
    end: timeToMinutes(o.end_time),
    from: o.origin_date && o.origin_date !== o.date ? o.origin_date : undefined,
  }));

  return { today, timezone, blocks, changes, freeDays: freeDays.map((f) => ({ from: f.from_date, to: f.to_date, note: f.note })) };
}

/** "Mon–Fri", "Mon, Wed, Sat", "Every day" from ISO weekdays. */
export function dayList(days: number[]) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "Every day";
  const runs: number[][] = [];
  for (const x of d) {
    const last = runs[runs.length - 1];
    if (last && x === last[last.length - 1] + 1) last.push(x);
    else runs.push([x]);
  }
  return runs
    .map((r) => (r.length >= 3 ? `${ISO_DAY_SHORT[r[0] - 1]}–${ISO_DAY_SHORT[r[r.length - 1] - 1]}` : r.map((x) => ISO_DAY_SHORT[x - 1]).join(", ")))
    .join(", ");
}

/** Same time on several days → one line: { days: "Mon–Fri", r }. */
export function groupSlots(slots: SlotRow[]) {
  const groups = new Map<string, { days: number[]; r: SlotRow }>();
  for (const r of slots) {
    const key = `${r.start}|${r.end}|${r.validFrom > "" && r.startsLater ? r.validFrom : ""}|${r.validTo ?? ""}`;
    const g = groups.get(key);
    if (g) g.days.push(r.weekday);
    else groups.set(key, { days: [r.weekday], r });
  }
  return [...groups.values()]
    .sort((a, b) => Math.min(...a.days) - Math.min(...b.days) || a.r.start - b.r.start)
    .map((g) => ({ days: dayList(g.days), r: g.r }));
}

function slotText(r: SlotRow) {
  let s = `${t(r.start)} – ${t(r.end)}${r.nextDay ? " (next day)" : ""} · ${hm(r.minutes)} · every week`;
  if (r.startsLater) s += ` · starts ${shortDate(r.validFrom)}`;
  if (r.validTo) s += ` · until ${shortDate(r.validTo)}`;
  return s;
}
function changeText(c: Change) {
  if (c.kind === "cancelled") return `${shortDate(c.date)} · ${c.block} · not happening that day`;
  const time = `${t(c.start)} – ${t(c.end)}`;
  if (c.kind === "moved") return `${shortDate(c.date)} · ${c.block} · moved to ${time}${c.from ? ` (from ${shortDate(c.from)})` : ""}`;
  return `${shortDate(c.date)} · ${c.block} · extra, ${time}`;
}

/** Week grid by day: [weekday, list of "7:00 AM – 8:00 AM Gym"]. */
function byDay(s: Summary) {
  return DAY_LONG.map((day, i) => {
    const items = s.blocks
      .flatMap((b) => b.slots.filter((r) => r.weekday === i + 1 && !r.startsLater).map((r) => ({ r, b })))
      .sort((x, y) => x.r.start - y.r.start)
      .map(({ r, b }) => ({ time: `${t(r.start)} – ${t(r.end)}${r.nextDay ? "+1" : ""}`, name: b.name, minutes: r.minutes }));
    return { day, items, minutes: items.reduce((a, x) => a + x.minutes, 0) };
  });
}

// ---------- CSV ----------
export function summaryCsv(s: Summary) {
  const rows: Record<string, unknown>[] = [];
  for (const b of s.blocks) {
    for (const r of b.slots) {
      rows.push({
        block: b.name,
        type: "weekly",
        weekday: DAY_LONG[r.weekday - 1],
        weekday_number: r.weekday,
        date: "",
        start: t(r.start),
        end: t(r.end),
        ends_next_day: r.nextDay ? "yes" : "no",
        duration_hours: +(r.minutes / 60).toFixed(2),
        repeats: "every week",
        valid_from: r.validFrom,
        valid_to: r.validTo ?? "",
        block_hours_per_week: +(b.weeklyMinutes / 60).toFixed(2),
        habits: b.habits.join("; "),
        color: b.color,
      });
    }
    if (!b.slots.length) {
      rows.push({ block: b.name, type: "no time slots", block_hours_per_week: 0, habits: b.habits.join("; "), color: b.color });
    }
  }
  for (const c of s.changes) {
    const wd = (new Date(`${c.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    rows.push({
      block: c.block,
      type: c.kind === "cancelled" ? "one-off: cancelled" : c.kind === "moved" ? "one-off: moved" : "one-off: extra",
      weekday: DAY_LONG[wd],
      weekday_number: wd + 1,
      date: c.date,
      start: c.kind === "cancelled" ? "" : t(c.start),
      end: c.kind === "cancelled" ? "" : t(c.end),
      duration_hours: c.kind === "cancelled" ? "" : +(span(c.start, c.end) / 60).toFixed(2),
      repeats: "once",
    });
  }
  const cols = ["block", "type", "weekday", "weekday_number", "date", "start", "end", "ends_next_day", "duration_hours", "repeats", "valid_from", "valid_to", "block_hours_per_week", "habits", "color"];
  return "﻿" + toCsv(rows, cols); // BOM so Excel shows accents correctly
}

// ---------- Plain text ----------
export function summaryText(s: Summary) {
  const L: string[] = [];
  const total = s.blocks.reduce((a, b) => a + b.weeklyMinutes, 0);
  const rule = "=".repeat(64);
  L.push("PERSONAL OS — BLOCKS SUMMARY");
  L.push(rule);
  L.push(`Generated: ${shortDate(s.today)}   Time zone: ${s.timezone}`);
  L.push(`Blocks: ${s.blocks.length}   Planned per week: ${hm(total)}`);
  L.push("");
  L.push("");
  L.push("WEEK AT A GLANCE");
  L.push("-".repeat(64));
  for (const d of byDay(s)) {
    L.push("");
    L.push(`${d.day.toUpperCase()}${d.items.length ? `  (${hm(d.minutes)})` : ""}`);
    if (!d.items.length) L.push("    — nothing —");
    for (const it of d.items) L.push(`    ${it.time.padEnd(22)}${it.name}`);
  }
  L.push("");
  L.push("");
  L.push("BY BLOCK");
  L.push("-".repeat(64));
  for (const b of s.blocks) {
    L.push("");
    L.push(`${b.name.toUpperCase()}   ${hm(b.weeklyMinutes)} per week · ${b.slots.length} time slot${b.slots.length === 1 ? "" : "s"}`);
    if (b.habits.length) L.push(`    Habits: ${b.habits.join(", ")}`);
    if (!b.slots.length) L.push("    No time slots (not on the calendar).");
    for (const g of groupSlots(b.slots)) L.push(`    ${g.days.padEnd(16)}${slotText(g.r)}`);
  }
  L.push("");
  L.push("");
  L.push(`CHANGES IN THE NEXT ${AHEAD} DAYS`);
  L.push("-".repeat(64));
  L.push("");
  if (!s.changes.length && !s.freeDays.length) L.push("    None: every block happens at its usual time.");
  for (const f of s.freeDays) L.push(`    Free day${f.from === f.to ? "" : "s"}: ${shortDate(f.from)}${f.from === f.to ? "" : ` – ${shortDate(f.to)}`} · all blocks paused${f.note ? ` · ${f.note}` : ""}`);
  for (const c of s.changes) L.push(`    ${changeText(c)}`);
  L.push("");
  return L.join("\r\n");
}

// ---------- PDF (hand-made, no library: Helvetica, A4) ----------
const WIN: Record<string, number> = { "–": 0x96, "—": 0x97, "•": 0x95, "…": 0x85, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "€": 0x80 };
function pdfStr(s: string) {
  let out = "";
  for (const ch of s) {
    const code = WIN[ch] ?? ch.charCodeAt(0);
    const c = code < 256 && ch.length === 1 ? code : 63; // "?" for anything WinAnsi can't show
    const x = String.fromCharCode(c);
    out += x === "(" || x === ")" || x === "\\" ? `\\${x}` : x;
  }
  return `(${out})`;
}
function rgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x6366f1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(" ");
}
/** Very rough Helvetica width, good enough to wrap lines. */
const fits = (size: number, width: number) => Math.floor(width / (size * 0.52));
function wrap(text: string, max: number) {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if ((line + " " + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export function summaryPdf(s: Summary): ArrayBuffer {
  const W = 595, H = 842, M = 48, CW = W - 2 * M;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  const newPage = () => {
    if (ops.length) pages.push(ops.join("\n"));
    ops = [];
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (str: string, x: number, size: number, bold = false, gray = 0.1) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${x} ${y.toFixed(1)} Td ${pdfStr(str)} Tj ET`);
  const line = (str: string, opts: { size?: number; bold?: boolean; indent?: number; gray?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const x = M + (opts.indent ?? 0);
    for (const part of wrap(str, fits(size, CW - (opts.indent ?? 0)))) {
      need(size + 4);
      y -= size + 4;
      text(part, x, size, opts.bold, opts.gray ?? 0.1);
    }
    y -= opts.gap ?? 0;
  };
  const heading = (str: string) => {
    need(40);
    y -= 14;
    line(str, { size: 13, bold: true });
    ops.push(`0.85 G 0.8 w ${M} ${(y - 5).toFixed(1)} m ${W - M} ${(y - 5).toFixed(1)} l S`);
    y -= 10;
  };

  const total = s.blocks.reduce((a, b) => a + b.weeklyMinutes, 0);
  line("Personal OS — Blocks summary", { size: 20, bold: true, gap: 4 });
  line(`Generated ${shortDate(s.today)} · ${s.timezone} · ${s.blocks.length} blocks · ${hm(total)} planned per week`, { size: 10, gray: 0.4, gap: 6 });

  heading("Week at a glance");
  for (const d of byDay(s)) {
    need(30);
    line(`${d.day}${d.items.length ? `  ·  ${hm(d.minutes)}` : ""}`, { size: 11, bold: true, gap: 1 });
    if (!d.items.length) line("Nothing scheduled", { indent: 14, gray: 0.5 });
    for (const it of d.items) {
      need(14);
      y -= 14;
      text(it.time, M + 14, 10, false, 0.35);
      text(it.name, M + 150, 10);
    }
    y -= 6;
  }

  heading("By block");
  for (const b of s.blocks) {
    need(46);
    y -= 16;
    ops.push(`${rgb(b.color)} rg ${M} ${(y - 1).toFixed(1)} 10 10 re f`);
    text(b.name, M + 16, 12, true);
    text(`${hm(b.weeklyMinutes)} per week`, W - M - 90, 10, false, 0.4);
    y -= 2;
    if (b.habits.length) line(`Habits: ${b.habits.join(", ")}`, { indent: 16, size: 9, gray: 0.4 });
    if (!b.slots.length) line("No time slots (not on the calendar)", { indent: 16, gray: 0.5 });
    for (const g of groupSlots(b.slots)) {
      need(14);
      y -= 14;
      text(g.days, M + 16, 10, false, 0.35);
      text(slotText(g.r), M + 130, 10);
    }
    y -= 8;
  }

  heading(`Changes in the next ${AHEAD} days`);
  if (!s.changes.length && !s.freeDays.length) line("None: every block happens at its usual time.", { gray: 0.4 });
  for (const f of s.freeDays)
    line(`Free day${f.from === f.to ? "" : "s"}: ${shortDate(f.from)}${f.from === f.to ? "" : ` – ${shortDate(f.to)}`} · all blocks paused${f.note ? ` · ${f.note}` : ""}`);
  for (const c of s.changes) line(changeText(c));
  newPage();

  // Assemble the file: catalog, pages, fonts, one content stream per page
  const objs: string[] = [];
  const add = (o: string) => objs.push(o) ; // object number = index + 1
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((content, i) => {
    const footer = `BT /F1 8 Tf 0.55 g ${M} 24 Td ${pdfStr(`Personal OS · Blocks summary · page ${i + 1} of ${pages.length}`)} Tj ET`;
    const stream = `${content}\n${footer}`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentNo = objs.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
    kids.push(objs.length);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is one byte (0-255), so latin1 keeps lengths and offsets exact
  const buf = Buffer.from(out, "latin1");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
