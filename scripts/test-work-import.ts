// Importing the Notion class table: delimiters, dates in several formats, times, hours, money, links and bad rows.
import { findDate, findTimes, parseNotionTable, parseWhen, splitDelimited } from "@/lib/work-import";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));
const TODAY = "2026-11-02";

// ---- split
ok("split: tabs", JSON.stringify(splitDelimited("a\tb\tc\n1\t2\t3")) === '[["a","b","c"],["1","2","3"]]');
ok("split: commas with quotes", JSON.stringify(splitDelimited('a,"b, c",d')) === '[["a","b, c","d"]]');
ok("split: escaped quote and line break inside quotes", JSON.stringify(splitDelimited('x,"he said ""hi""\nbye"')) === '[["x","he said \\"hi\\"\\nbye"]]');
ok("split: Windows line endings", splitDelimited("a,b\r\nc,d\r\n").length === 2);

// ---- dates
ok("date: Oct 27 (no year → this year)", findDate("Oct 27 9:00 PM", TODAY) === "2026-10-27");
ok("date: October 27, 2026", findDate("October 27, 2026 9:00 PM", TODAY) === "2026-10-27");
ok("date: 27 Oct 2026", findDate("27 Oct 2026", TODAY) === "2026-10-27");
ok("date: ISO", findDate("2026-10-27 21:00", TODAY) === "2026-10-27");
ok("date: Spanish", findDate("27 de octubre de 2026 9:00 PM", TODAY) === "2026-10-27");
ok("date: Spanish month first", findDate("octubre 27, 2026", TODAY) === "2026-10-27");
ok("date: ordinal", findDate("Oct 21st", TODAY) === "2026-10-21");
ok("date: month/day/year", findDate("10/27/2026", TODAY) === "2026-10-27");
ok("date: day/month/year when the first number is over 12", findDate("27/10/2026", TODAY) === "2026-10-27");
ok("date: December without year, seen in November → last year", findDate("Dec 20 9:00 PM", TODAY) === "2025-12-20", String(findDate("Dec 20 9:00 PM", TODAY)));
ok("date: a few days ahead stays this year", findDate("Nov 10 9:00 PM", TODAY) === "2026-11-10");
ok("date: PM is not a month", findDate("9:00 PM → 10:00 PM", TODAY) === null);
ok("date: impossible day", findDate("Feb 30", TODAY) === null);

// ---- times
ok("times: 12-hour", findTimes("Oct 27 9:00 PM → 10:00 PM").join(",") === "21:00,22:00", findTimes("Oct 27 9:00 PM → 10:00 PM").join(","));
ok("times: no minutes", findTimes("9 PM to 10 PM").join(",") === "21:00,22:00");
ok("times: lowercase and dots", findTimes("9:30 p.m.").join(",") === "21:30");
ok("times: noon and midnight", findTimes("12:00 PM 12:00 AM").join(",") === "12:00,00:00");
ok("times: 24-hour", findTimes("2026-10-27 21:00 → 22:30").join(",") === "21:00,22:30");
ok("times: the year is not a time", findTimes("October 27, 2026 9:00 PM").join(",") === "21:00");

// ---- when
const w1 = parseWhen("Oct 27 9:00 PM → 10:00 PM", TODAY);
ok("when: Notion table cell", !("error" in w1) && w1.date === "2026-10-27" && w1.start === "21:00" && w1.end === "22:00");
const w2 = parseWhen("October 27, 2026 9:00 PM (GMT-5) → 10:00 PM (GMT-5)", TODAY);
ok("when: CSV export with time zone", !("error" in w2) && w2.date === "2026-10-27" && w2.start === "21:00" && w2.end === "22:00", JSON.stringify(w2));
const w3 = parseWhen("October 27, 2026 11:00 PM → October 28, 2026 12:00 AM", TODAY);
ok("when: end with its own date", !("error" in w3) && w3.date === "2026-10-27" && w3.start === "23:00" && w3.end === "00:00", JSON.stringify(w3));
const w4 = parseWhen("October 27, 2026 @9:00 PM → 10:00 PM", TODAY);
ok("when: '@' separator", !("error" in w4) && w4.start === "21:00");
ok("when: no end → error", "error" in parseWhen("Oct 27 9:00 PM", TODAY));
ok("when: no date → error", "error" in parseWhen("9:00 PM → 10:00 PM", TODAY));
ok("when: same start and end → error", "error" in parseWhen("Oct 27 9:00 PM → 9:00 PM", TODAY));
ok("when: empty → error", "error" in parseWhen("", TODAY));

// ---- the table
const notion = [
  "Clase\tHorario\tURL\tHoras\tDinero\tasistencia\tConcat",
  "B2-5\tOct 27 9:00 PM → 10:00 PM\t\t1\t$6.00\t\t1 hora",
  "B1-6\tOct 27 8:00 PM → 9:00 PM\thttps://drive.google.com/file/d/1/view\t1\t$6.00\t\t1 hora",
  "A2-3\tOct 21 7:00 PM → 8:30 PM\t\t1.5\t$9.00\t\t1 hora",
  "",
  "X9\tsomething odd\t\t1\t$6.00",
].join("\n");
const r = parseNotionTable(notion, TODAY);
ok("table: header detected", r.hasHeader);
ok("table: 3 good rows and 1 error", r.rows.length === 3 && r.errors.length === 1, `${r.rows.length}/${r.errors.length}`);
ok("table: error says the line and why", r.errors[0].line === 6 && /date/i.test(r.errors[0].reason), JSON.stringify(r.errors[0]));
ok("table: first row", r.rows[0].group_name === "B2-5" && r.rows[0].class_date === "2026-10-27" && r.rows[0].start_time === "21:00" && r.rows[0].end_time === "22:00" && r.rows[0].hours === 1);
ok("table: rate from the money column", r.rows[0].rate === 6 && r.rows[2].rate === 6, `${r.rows[0].rate}/${r.rows[2].rate}`);
ok("table: video link kept, empty one is null", r.rows[1].video_url === "https://drive.google.com/file/d/1/view" && r.rows[0].video_url === null);
ok("table: 1.5 h class", r.rows[2].hours === 1.5);

const csv = 'Clase,Horario,URL,Horas,Dinero\nB2-5,"October 27, 2026 9:00 PM (GMT-5) → 10:00 PM (GMT-5)",,1,$6\n';
const rc = parseNotionTable(csv, TODAY);
ok("csv: Notion export", rc.rows.length === 1 && rc.rows[0].start_time === "21:00" && rc.rows[0].rate === 6, JSON.stringify(rc));

const noHead = parseNotionTable("B2-5\tOct 27 9:00 PM → 10:00 PM\t\t1\t$6.00", TODAY);
ok("no header: Notion's own column order", !noHead.hasHeader && noHead.rows.length === 1 && noHead.rows[0].group_name === "B2-5");

const spanish = parseNotionTable("Clase\tHorario\nA1-6\t27 de octubre de 2026 8:00 PM → 9:00 PM", TODAY);
ok("Spanish date in a table", spanish.rows.length === 1 && spanish.rows[0].class_date === "2026-10-27");

const noMoney = parseNotionTable("Clase\tHorario\nA1-6\tOct 27 8:00 PM → 9:00 PM", TODAY);
ok("no money column → null rate (your default applies)", noMoney.rows[0].rate === null);

ok("wrong table → nothing imported, every line explained", parseNotionTable("foo\tbar\n1\t2", TODAY).errors.length === 2 && parseNotionTable("foo\tbar\n1\t2", TODAY).rows.length === 0);
ok("header without a Horario column → asks for it", (() => { const e = parseNotionTable("Clase\tFoo\nA\tx", TODAY); return e.rows.length === 0 && e.errors.length === 1 && /Horario/.test(e.errors[0].reason); })());
ok("empty text → nothing", parseNotionTable("   \n", TODAY).rows.length === 0);
ok("half-hour rate: $9 for 1.5 h = $6", parseNotionTable("Clase\tHorario\tDinero\nA\tOct 27 7:00 PM → 8:30 PM\t$9", TODAY).rows[0].rate === 6);

console.log(fail ? `\n${fail} failed, ${pass} passed` : `✅ work-import: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
