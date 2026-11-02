// Work log: hours and pay, the company Sheet's formats (date, time range, month), month totals and the paste-ready text.
import {
  byTime, calcAmount, calcHours, classEnded, detailRows, fmtHours, fmtMoney, hasEvidence, hhmm, parseVideoCmd, ruleError, isHttpUrl, isValidForReport, missingEvidence, needsEvidence, isMonthKey, monthBounds, monthKey, monthLabelEn,
  monthLabelEs, rateFor, sheetDate, sheetRange, shiftMonth, shortDay, summarize, summaryRow, toMinutes, toTsv, type WorkClass,
} from "@/lib/work-log";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));

// ---- clock + hours
ok("toMinutes: 20:00:00", toMinutes("20:00:00") === 1200);
ok("toMinutes: 8:05", toMinutes("8:05") === 485);
ok("toMinutes: invalid", Number.isNaN(toMinutes("25:00")) && Number.isNaN(toMinutes("ab")) && Number.isNaN(toMinutes("10:75")));
ok("hhmm trims seconds", hhmm("21:00:00") === "21:00" && hhmm("9:00") === "09:00");
ok("hours: 1h", calcHours("21:00", "22:00") === 1);
ok("hours: 1.5h", calcHours("19:00", "20:30") === 1.5);
ok("hours: 20 min → 0.33", calcHours("19:00", "19:20") === 0.33);
ok("hours: past midnight", calcHours("23:00", "00:30") === 1.5);
ok("hours: same time → 0", calcHours("10:00", "10:00") === 0);
ok("hours: invalid → 0", calcHours("x", "10:00") === 0);
ok("amount: 1h × $6", calcAmount(1, 6) === 6);
ok("amount: 1.5h × $6", calcAmount(1.5, 6) === 9);
ok("amount: 0.33h × $6 rounds to cents", calcAmount(0.33, 6) === 1.98);
ok("money format", fmtMoney(6) === "$6.00" && fmtMoney(1234.5) === "$1234.50");
ok("hours format", fmtHours(1) === "1" && fmtHours(1.5) === "1.5" && fmtHours(0.25) === "0.25");

// ---- Sheet formats
ok("sheet date: 2026-01-04 → 4-Jan-26", sheetDate("2026-01-04") === "4-Jan-26", sheetDate("2026-01-04"));
ok("sheet date: 2026-10-27", sheetDate("2026-10-27") === "27-Oct-26");
ok("range: 8 to 9 PM", sheetRange("20:00", "21:00") === "De 8 a 9 PM", sheetRange("20:00", "21:00"));
ok("range: 3 to 4 PM", sheetRange("15:00", "16:00") === "De 3 a 4 PM");
ok("range: 10 to 11 AM", sheetRange("10:00", "11:00") === "De 10 a 11 AM");
ok("range: crossing noon", sheetRange("11:00", "13:00") === "De 11 AM a 1 PM", sheetRange("11:00", "13:00"));
ok("range: 12 PM is noon", sheetRange("12:00", "13:00") === "De 12 a 1 PM", sheetRange("12:00", "13:00"));
ok("range: half hours", sheetRange("19:30", "20:30") === "De 7:30 a 8:30 PM", sheetRange("19:30", "20:30"));
ok("range: past midnight", sheetRange("23:00", "00:00") === "De 11 PM a 12 AM", sheetRange("23:00", "00:00"));
ok("range accepts HH:MM:SS from the database", sheetRange("21:00:00", "22:00:00") === "De 9 a 10 PM");
ok("month label ES", monthLabelEs("2026-01") === "Enero-2026" && monthLabelEs("2026-09") === "Septiembre-2026");
ok("month label EN", monthLabelEn("2026-10") === "October 2026");

ok("short day: Tue, Oct 27", shortDay("2026-10-27") === "Tue, Oct 27", shortDay("2026-10-27"));
ok("short day: Sun, Jan 4", shortDay("2026-01-04") === "Sun, Jan 4", shortDay("2026-01-04"));
ok("url check", isHttpUrl("https://drive.google.com/file/d/1/view") && isHttpUrl("http://a.co") && !isHttpUrl("drive.google.com") && !isHttpUrl("javascript:alert(1)") && !isHttpUrl("https://a b"));

// ---- months
ok("month key", monthKey("2026-10-27") === "2026-10" && isMonthKey("2026-10") && !isMonthKey("2026-13") && !isMonthKey("26-10"));
ok("shift month forward over the year", shiftMonth("2026-12", 1) === "2027-01");
ok("shift month back over the year", shiftMonth("2026-01", -1) === "2025-12");
ok("month bounds: October", monthBounds("2026-10").from === "2026-10-01" && monthBounds("2026-10").to === "2026-10-31");
ok("month bounds: Feb 2028 (leap)", monthBounds("2028-02").to === "2028-02-29");
ok("month bounds: Feb 2026", monthBounds("2026-02").to === "2026-02-28");
ok("month bounds: December", monthBounds("2026-12").to === "2026-12-31");

// ---- rates
ok("rate: substitute default 6", rateFor("substitute", { substitute_rate: null, head_rate: null }) === 6);
ok("rate: head default 4", rateFor("head", { substitute_rate: null, head_rate: null }) === 4);
ok("rate: custom", rateFor("substitute", { substitute_rate: 7.5, head_rate: 4 }) === 7.5);
ok("rate: nonsense falls back", rateFor("head", { substitute_rate: 6, head_rate: -3 }) === 4);

// ---- classes
let n = 0;
const cls = (o: Partial<WorkClass>): WorkClass => {
  const base: WorkClass = {
    id: `c${++n}`, class_date: "2026-10-27", start_time: "20:00:00", end_time: "21:00:00", group_name: "B1-6", role: "substitute",
    sheet_type: "collaboration", requested_by: "Felipe", hours: 1, rate: 6, amount: 6, video_posted: false, video_url: null, notes: null, status: "taught", attendance_urls: [],
  };
  return { ...base, ...o };
};
const list = [
  cls({ class_date: "2026-10-27", start_time: "21:00:00", end_time: "22:00:00", group_name: "B2-5", video_posted: true, video_url: "https://drive.google.com/x" }),
  cls({ class_date: "2026-10-21", start_time: "14:00:00", end_time: "15:00:00", group_name: "B2-13", sheet_type: "extra", requested_by: "Academia", video_posted: true, video_url: "https://drive.google.com/e" }),
  cls({ class_date: "2026-10-21", start_time: "19:00:00", end_time: "20:30:00", group_name: "A2-3", sheet_type: "recovery", requested_by: "Propia", hours: 1.5, amount: 9 }),
  cls({ class_date: "2026-10-28", group_name: "A1-6", sheet_type: null, requested_by: null, notes: "not reported" }),
];
ok("sort: by date then time", [...list].sort(byTime).map((c) => c.group_name).join(",") === "B2-13,A2-3,B2-5,A1-6", [...list].sort(byTime).map((c) => c.group_name).join(","));

const now = { date: "2026-10-27", minutes: 21 * 60 + 30 }; // Oct 27, 9:30 PM
ok("ended: yesterday's class", classEnded(list[1], now));
ok("ended: today, finished", classEnded(cls({ class_date: "2026-10-27", start_time: "19:00", end_time: "20:00" }), now));
ok("ended: today, still running", !classEnded(cls({ class_date: "2026-10-27", start_time: "21:00", end_time: "22:00" }), now));
ok("ended: tomorrow's class", !classEnded(list[3], now));
ok("ended: past-midnight class started last night, ended", classEnded(cls({ class_date: "2026-10-26", start_time: "23:00", end_time: "00:30" }), now));
ok("ended: past-midnight class tonight, not yet", !classEnded(cls({ class_date: "2026-10-27", start_time: "23:00", end_time: "00:30" }), now));

const s = summarize(list, now);
ok("summary: classes", s.classes === 4);
ok("summary: hours", s.hours === 4.5, String(s.hours));
ok("summary: amount", s.amount === 27, String(s.amount));
ok("summary: recovered hours without evidence are not counted", s.recoveryHours === 0, String(s.recoveryHours));
ok("summary: missing evidence is reported", s.missingEvidenceCount === 1 && s.missingEvidenceHours === 1.5);
ok("summary: extra hours", s.extraHours === 1);
ok("summary: collaboration count & hours", s.collaborationCount === 1 && s.collaborationHours === 1);
ok("summary: videos pending counts only finished classes without video", s.videosPending === 1, String(s.videosPending)); // A2-3 (Oct 21); A1-6 is tomorrow
ok("summary without 'now' counts every missing video", summarize(list).videosPending === 2);

const rows = detailRows(list);
ok("detail rows: no Sheet type, or extra/recovered without video link, are left out", rows.length === 2, String(rows.length));
ok("detail rows: in date order", rows.map((r) => r[2]).join(",") === "B2-13,B2-5", rows.map((r) => r[2]).join(","));
ok("detail row cells", rows[0].join("|") === "21-Oct-26|De 2 a 3 PM|B2-13|Hora Extra|Academia|https://drive.google.com/e|", rows[0].join("|"));
ok("detail row: Evidencia is the video link", rows[1][5] === "https://drive.google.com/x");
ok("detail row: type names as in the Sheet", rows[0][3] === "Hora Extra" && rows[1][3] === "Colaboración");

const sr = summaryRow("Max Principal", "2026-10", 0, s);
ok("summary row", sr.join("|") === "Max Principal|Octubre-2026|0|0|1|1", sr.join("|"));

// ---- evidence rule (company guidelines)
ok("evidence: extra and recovery need it, collaboration does not", needsEvidence("extra") && needsEvidence("recovery") && !needsEvidence("collaboration") && !needsEvidence(null));
ok("evidence: posted + link", hasEvidence({ video_posted: true, video_url: "https://d/x" }));
ok("evidence: posted without link is not enough", !hasEvidence({ video_posted: true, video_url: null }) && !hasEvidence({ video_posted: true, video_url: "  " }));
ok("evidence: link without 'posted' is not enough", !hasEvidence({ video_posted: false, video_url: "https://d/x" }));
ok("valid for report: collaboration needs nothing", isValidForReport({ sheet_type: "collaboration", video_posted: false, video_url: null }));
ok("valid for report: no type → no", !isValidForReport({ sheet_type: null, video_posted: true, video_url: "https://d/x" }));
ok("valid for report: extra without link → no", !isValidForReport({ sheet_type: "extra", video_posted: true, video_url: null }));
ok("missing evidence list", missingEvidence(list).map((c) => c.group_name).join(",") === "A2-3");
const withProof = summarize([cls({ sheet_type: "recovery", hours: 1.5, amount: 9, video_posted: true, video_url: "https://d/r" }), cls({ sheet_type: "extra", video_posted: true, video_url: "https://d/e" })]);
ok("summary: with evidence the hours count", withProof.recoveryHours === 1.5 && withProof.extraHours === 1 && withProof.missingEvidenceCount === 0);
ok("summary: collaborations never count as extra or recovered hours", summarize([cls({ sheet_type: "collaboration", video_posted: true, video_url: "https://d/c" })]).extraHours === 0);

// ---- rules about who requests a class
ok("rule: extra needs someone to request it", ruleError("extra", "") !== null && ruleError("extra", null) !== null);
ok("rule: extra is never 'Propia'", ruleError("extra", "Propia") !== null && ruleError("extra", " propia ") !== null);
ok("rule: extra requested by the academy or a teacher is fine", ruleError("extra", "Academia") === null && ruleError("extra", "Felipe") === null);
ok("rule: collaboration names the teacher", ruleError("collaboration", "") !== null && ruleError("collaboration", "Felipe") === null);
ok("rule: recovery and untyped classes are free", ruleError("recovery", "") === null && ruleError(null, "") === null && ruleError("", null) === null);

// ---- cancelled by the student
const cancelled = [
  cls({ group_name: "P1", sheet_type: "extra", requested_by: "Academia", video_posted: true, video_url: "https://d/p1" }),
  cls({ group_name: "P2", sheet_type: "extra", requested_by: "Academia", status: "cancelled_early", hours: 1, rate: 0, amount: 0 }),
  cls({ group_name: "P3", sheet_type: "extra", requested_by: "Academia", status: "cancelled_late", hours: 1, rate: 6, amount: 6 }),
];
const sc = summarize(cancelled, { date: "2026-10-28", minutes: 600 });
ok("cancelled: not counted as classes or hours", sc.classes === 1 && sc.hours === 1 && sc.cancelled === 2, `${sc.classes}/${sc.hours}/${sc.cancelled}`);
ok("cancelled: a paid late cancellation still counts in the money", sc.amount === 12, String(sc.amount));
ok("cancelled: never in extra hours", sc.extraHours === 1);
ok("cancelled: never need a video", sc.videosPending === 0 && sc.missingEvidenceCount === 0 && missingEvidence(cancelled).length === 0);
ok("cancelled: never in the report", detailRows(cancelled).length === 1 && !isValidForReport(cancelled[1]) && !isValidForReport(cancelled[2]));

// ---- Telegram: video command
const v1 = parseVideoCmd("video B2-5 https://drive.google.com/file/d/1/view");
ok("video cmd: class + link", v1?.group === "B2-5" && v1.url === "https://drive.google.com/file/d/1/view");
const v2 = parseVideoCmd("video https://drive.google.com/x");
ok("video cmd: only the link → latest class", v2?.group === null && v2.url === "https://drive.google.com/x");
ok("video cmd: slash and accent", parseVideoCmd("/vídeo a1-6 https://d/x")?.group === "a1-6");
ok("video cmd: not a link → not a command", parseVideoCmd("video B2-5 later") === null && parseVideoCmd("video") === null && parseVideoCmd("videos B2-5 https://d/x") === null);

ok("tsv: tabs and rows", toTsv([["a", "b"], ["c", "d"]]) === "a\tb\nc\td");
ok("tsv: tabs and line breaks inside a cell become spaces", toTsv([["x\ty", "l1\nl2"]]) === "x y\tl1 l2");

console.log(fail ? `\n${fail} failed, ${pass} passed` : `✅ work-log: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
