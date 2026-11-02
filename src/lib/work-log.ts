// Work log (substitute ESL classes): hours, pay, the company Sheet's formats and month totals.
// Pure functions only — no database — so they can be tested on their own (npm run test:work).

export type WorkRole = "substitute" | "head";
export type SheetType = "recovery" | "extra" | "collaboration";
/** taught · cancelled_early = a personalized student cancelled BEFORE the class started (not a lost hour; reschedule if asked) ·
 *  cancelled_late = cancelled once it had started (you are exempt). Cancelled classes never count in the monthly report. */
export type WorkStatus = "taught" | "cancelled_early" | "cancelled_late";
export const STATUS_LABEL: Record<WorkStatus, string> = {
  taught: "Taught",
  cancelled_early: "Cancelled by the student before it started",
  cancelled_late: "Cancelled by the student after it started",
};

export const ROLE_LABEL: Record<WorkRole, string> = { substitute: "Substitute", head: "Head teacher" };
/** Names exactly as the company Sheet writes them (Tipo de clase). */
export const SHEET_TYPE_LABEL: Record<SheetType, string> = {
  recovery: "Recuperación",
  extra: "Hora Extra",
  collaboration: "Colaboración",
};
export const DEFAULT_RATES: Record<WorkRole, number> = { substitute: 6, head: 4 };

export type WorkClass = {
  id: string;
  class_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM or HH:MM:SS
  end_time: string;
  group_name: string; // "B2-5"
  role: WorkRole;
  sheet_type: SheetType | null; // null = a class that is not reported in the Sheet
  requested_by: string | null; // Sheet "Solicitud": Propia, Academia, a teacher's name
  hours: number;
  rate: number;
  amount: number;
  video_posted: boolean;
  video_url: string | null;
  notes: string | null;
  status: WorkStatus;
  attendance_urls: string[];
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_EN_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "20:00:00" | "8:00" → minutes since midnight (NaN if invalid). */
export function toMinutes(t: string) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t).trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? NaN : h * 60 + mi;
}

/** "20:00:00" → "20:00" */
export function hhmm(t: string) {
  const m = toMinutes(t);
  return Number.isNaN(m) ? t : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Hours between two clock times, rounded to 2 decimals. An end before the start means past midnight. Equal → 0. */
export function calcHours(start: string, end: string) {
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return 0;
  const mins = b > a ? b - a : b + 1440 - a;
  return Math.round((mins / 60) * 100) / 100;
}

export function calcAmount(hours: number, rate: number) {
  return Math.round(hours * rate * 100) / 100;
}

export function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

/** 1 → "1", 1.5 → "1.5", 0.25 → "0.25" */
export function fmtHours(h: number) {
  return String(Math.round(h * 100) / 100);
}

/** "2026-01-04" → "4-Jan-26" (how the Sheet shows dates). */
export function sheetDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}-${MONTHS_EN[m - 1]}-${String(y).slice(-2)}`;
}

function clock12(min: number) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: m ? `${h}:${String(m).padStart(2, "0")}` : String(h), ap };
}

/** "20:00","21:00" → "De 8 a 9 PM"; "10:00","11:00" → "De 10 a 11 AM"; "11:00","13:00" → "De 11 AM a 1 PM". */
export function sheetRange(start: string, end: string) {
  const a = clock12(toMinutes(start));
  const b = clock12(toMinutes(end));
  return a.ap === b.ap ? `De ${a.text} a ${b.text} ${b.ap}` : `De ${a.text} ${a.ap} a ${b.text} ${b.ap}`;
}

/** "2026-01" → "Enero-2026" (Resumen "Mes-Año"). */
export function monthLabelEs(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_ES[m - 1]}-${y}`;
}

/** "2026-01" → "January 2026" */
export function monthLabelEn(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_EN_LONG[m - 1]} ${y}`;
}

export const monthKey = (date: string) => date.slice(0, 7);
export const isMonthKey = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** First and last day (YYYY-MM-DD) of a month key. */
export function monthBounds(key: string) {
  const next = shiftMonth(key, 1);
  const last = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5)) - 1, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

export const byTime = (a: WorkClass, b: WorkClass) =>
  a.class_date.localeCompare(b.class_date) || toMinutes(a.start_time) - toMinutes(b.start_time);

/** Has the class already finished? (now = the user's local date and minutes). Past-midnight classes end the next day. */
export function classEnded(c: Pick<WorkClass, "class_date" | "start_time" | "end_time">, now: { date: string; minutes: number }) {
  const s = toMinutes(c.start_time);
  const e = toMinutes(c.end_time);
  if (c.class_date < now.date) return !(e < s && addOneDay(c.class_date) > now.date);
  if (c.class_date > now.date) return false;
  if (e < s) return false; // ends tomorrow
  return e <= now.minutes;
}

function addOneDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Company rule: extra and recovered hours need the full recording of the class as evidence, or they are void.
 *  Collaborations need no evidence. */
export const needsEvidence = (t: SheetType | null) => t === "extra" || t === "recovery";
export const hasEvidence = (c: Pick<WorkClass, "video_posted" | "video_url">) => c.video_posted && !!c.video_url?.trim();
/** Can this class go in the Sheet report? It needs a type and, for extra/recovery, the video link. */
/** includeNoLink: also accept Hora Extra / Recuperación whose video link is still missing (the Evidencia cell stays empty). */
export const isValidForReport = (c: Pick<WorkClass, "sheet_type" | "video_posted" | "video_url"> & { status?: WorkStatus }, includeNoLink = false) =>
  (c.status ?? "taught") === "taught" && !!c.sheet_type && (includeNoLink || !needsEvidence(c.sheet_type) || hasEvidence(c));
/** Extra/recovered classes that are still missing their evidence (oldest first). */
export const missingEvidence = (list: WorkClass[]) => list.filter((c) => c.status === "taught" && needsEvidence(c.sheet_type) && !hasEvidence(c)).sort(byTime);

export type WorkSummary = {
  classes: number;
  /** Classes cancelled by the student (not counted in hours or the report). */
  cancelled: number;
  hours: number;
  amount: number;
  recoveryHours: number;
  extraHours: number;
  collaborationHours: number;
  collaborationCount: number;
  /** Extra/recovered classes without evidence: left out of the Sheet numbers until the video link is added. */
  missingEvidenceCount: number;
  missingEvidenceHours: number;
  /** Finished classes whose video is not marked as posted. */
  videosPending: number;
};

export function summarize(list: WorkClass[], now?: { date: string; minutes: number }, opts?: { includeNoLink?: boolean }): WorkSummary {
  const s: WorkSummary = { classes: 0, cancelled: 0, hours: 0, amount: 0, recoveryHours: 0, extraHours: 0, collaborationHours: 0, collaborationCount: 0, missingEvidenceCount: 0, missingEvidenceHours: 0, videosPending: 0 };
  for (const c of list) {
    s.amount += c.amount; // a late cancellation can still be paid (its rate is whatever you set)
    if (c.status !== "taught") {
      s.cancelled++;
      continue;
    }
    s.classes++;
    s.hours += c.hours;
    if (c.sheet_type === "recovery" || c.sheet_type === "extra") {
      if (!opts?.includeNoLink && !hasEvidence(c)) {
        s.missingEvidenceCount++;
        s.missingEvidenceHours += c.hours;
      } else if (c.sheet_type === "recovery") s.recoveryHours += c.hours;
      else s.extraHours += c.hours;
    }
    if (c.sheet_type === "collaboration") {
      s.collaborationHours += c.hours;
      s.collaborationCount++;
    }
    if (!c.video_posted && (!now || classEnded(c, now))) s.videosPending++;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { ...s, hours: r(s.hours), amount: r(s.amount), recoveryHours: r(s.recoveryHours), extraHours: r(s.extraHours), missingEvidenceHours: r(s.missingEvidenceHours), collaborationHours: r(s.collaborationHours) };
}

/** "Reporte detallado" tab: one row per class that has a Sheet type (extra/recovered ones only with their video link). Columns: Fecha, Horario, Grupo o estudiante,
 *  Tipo de clase, Solicitud, Evidencia, Información adicional y detalles. */
export const DETAIL_HEADERS = ["Fecha", "Horario", "Grupo o estudiante", "Tipo de clase", "Solicitud", "Evidencia", "Información adicional y detalles"];
export function detailRows(list: WorkClass[], includeNoLink = false) {
  return [...list]
    .filter((c) => isValidForReport(c, includeNoLink))
    .sort(byTime)
    .map((c) => [
      sheetDate(c.class_date),
      sheetRange(c.start_time, c.end_time),
      c.group_name,
      SHEET_TYPE_LABEL[c.sheet_type as SheetType],
      c.requested_by ?? "",
      c.video_url ?? "",
      c.notes ?? "",
    ]);
}

/** "Resumen" tab row: Docente, Mes-Año, Horas Perdidas, Horas Recuperadas, Horas Extra, Colaboraciones. */
export const SUMMARY_HEADERS = ["Docente", "Mes-Año", "Horas Perdidas", "Horas Recuperadas", "Horas Extra", "Colaboraciones"];
export function summaryRow(teacher: string, month: string, lostHours: number, s: WorkSummary) {
  return [teacher, monthLabelEs(month), String(lostHours), fmtHours(s.recoveryHours), fmtHours(s.extraHours), String(s.collaborationCount)];
}

/** Tab-separated text: pasting it into Google Sheets fills one cell per column. */
export function toTsv(rows: string[][]) {
  return rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/g, " ").trim()).join("\t")).join("\n");
}

/** Company rules about who requests a class: an Hora Extra is never on your own initiative, and a Colaboración names the
 *  teacher who sent the students. Returns the message to show, or null when the combination is fine. */
export function ruleError(sheetType: string | null | undefined, requestedBy: string | null | undefined) {
  const who = (requestedBy ?? "").trim();
  if (sheetType === "extra" && (!who || /^propia$/i.test(who)))
    return "A Hora Extra must be requested by another teacher or the academy. Write who asked (not “Propia”).";
  if (sheetType === "collaboration" && !who) return "Write which teacher sent you their students (Requested by).";
  return null;
}

/** Telegram: "video B2-5 https://drive…" (or just "video https://drive…" for the latest class without one). */
export function parseVideoCmd(text: string): { group: string | null; url: string } | null {
  const m = /^\/?v[ií]deo\s+(?:(\S+)\s+)?(https?:\/\/\S+)\s*$/i.exec(text.trim());
  return m ? { group: m[1] ?? null, url: m[2] } : null;
}

/** A database row → WorkClass. Numbers can arrive as text; the 0028 columns may not exist yet (then: taught, no screenshots). */
export function toWorkClass(r: Record<string, unknown>): WorkClass {
  const st = String(r.status ?? "taught");
  return {
    id: String(r.id),
    class_date: String(r.class_date),
    start_time: String(r.start_time),
    end_time: String(r.end_time),
    group_name: String(r.group_name),
    role: r.role === "head" ? "head" : "substitute",
    sheet_type: (r.sheet_type as SheetType | null) ?? null,
    requested_by: (r.requested_by as string | null) ?? null,
    hours: Number(r.hours),
    rate: Number(r.rate),
    amount: Number(r.amount),
    video_posted: Boolean(r.video_posted),
    video_url: (r.video_url as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: st === "cancelled_early" || st === "cancelled_late" ? st : "taught",
    attendance_urls: Array.isArray(r.attendance_urls) ? (r.attendance_urls as unknown[]).map(String) : [],
  };
}

/** Pays differ by role; null/invalid rate falls back to the default for that role. */
export function rateFor(role: WorkRole, rates: { substitute_rate: number | null; head_rate: number | null }) {
  const r = role === "head" ? rates.head_rate : rates.substitute_rate;
  return r !== null && Number.isFinite(r) && r >= 0 ? r : DEFAULT_RATES[role];
}

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-10-27" → "Tue, Oct 27" */
export function shortDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${DAYS_EN[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]}, ${MONTHS_EN[m - 1]} ${d}`;
}

export const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

/** A class code compared without caring about case or extra spaces ("KIDS-7" = "Kids-7"). */
export function groupKey(code: string) {
  return String(code ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Which teacher each class code belongs to right now: the teacher on your most recent class with that code, unless you saved
 * one for the code (`saved`) — that one wins until a class dated AFTER its `effective_from` day names someone else.
 * "Propia" is not a teacher, so it is never remembered. Keys are `groupKey`s.
 */
export function teacherMap(
  classes: { class_date: string; group_name: string; requested_by: string | null }[],
  saved: { code_key: string; teacher: string; effective_from?: string | null }[] = [],
): Record<string, string> {
  const latest: Record<string, { date: string; who: string }> = {};
  const newestFirst = [...classes].sort((a, b) => (a.class_date < b.class_date ? 1 : a.class_date > b.class_date ? -1 : 0));
  for (const c of newestFirst) {
    const who = (c.requested_by ?? "").trim();
    const k = groupKey(c.group_name);
    if (!k || !who || /^propia$/i.test(who) || latest[k]) continue;
    latest[k] = { date: c.class_date, who };
  }
  const out: Record<string, string> = {};
  for (const k of Object.keys(latest)) out[k] = latest[k].who;
  for (const s of saved) {
    const t = s.teacher.trim();
    if (!s.code_key || !t) continue;
    const l = latest[s.code_key];
    if (l && s.effective_from && l.date > s.effective_from) continue;
    out[s.code_key] = t;
  }
  return out;
}
