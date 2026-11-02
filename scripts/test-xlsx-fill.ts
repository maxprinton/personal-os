// Filling the company's .xlsx: values land in the right cells, the file keeps its look, the table grows, formulas are respected.
// Uses scripts/fixtures/*.xlsx (a stand-in made by scripts/make-xlsx-fixture.py).
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillWorkbook, readZip, colToNum, numToCol, type FillRow, type FillSummary } from "@/lib/xlsx-fill";
import { createZip } from "@/lib/zip";
import { templateBytes } from "@/lib/xlsx-template";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));
const txt = (zip: ReturnType<typeof readZip>, name: string) => {
  const e = zip.find((z) => z.name === name);
  return e ? Buffer.from(e.content).toString("utf8") : "";
};
const cellXml = (xml: string, ref: string) => new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? "";

ok("columns: letters ↔ numbers", colToNum("A") === 1 && colToNum("AB") === 28 && numToCol(1) === "A" && numToCol(28) === "AB" && numToCol(26) === "Z");

const rows: FillRow[] = [
  { date: "2026-10-27", time: "De 9 a 10 PM", group: "B2-5", type: "Hora Extra", requested: "Felipe", evidence: "https://drive.google.com/e1", info: "Felipe & the \"power\" <cut>" },
  { date: "2026-10-27", time: "De 8 a 9 PM", group: "B1-6", type: "Hora Extra", requested: "Academia", evidence: "https://drive.google.com/e2", info: "" },
  { date: "2026-10-21", time: "De 2 a 3 PM", group: "B2-13", type: "Colaboración", requested: "Ana", evidence: "", info: "sin video" },
  { date: "2026-10-21", time: "De 7 a 8 PM", group: "A2-3", type: "Hora Extra", requested: "Academia", evidence: "https://drive.google.com/e3", info: "" },
  { date: "2026-10-28", time: "De 7 a 8 PM", group: "A1-6", type: "Hora Extra", requested: "Academia", evidence: "https://drive.google.com/e4", info: "" },
];
const summary: FillSummary = { teacher: "Max & Co", month: "Octubre-2026", lost: 0, recovered: 0, extra: 4, collaborations: 1 };

// ---- the typed-values template
const src = new Uint8Array(readFileSync("scripts/fixtures/formato-ejemplo.xlsx"));
const before = readZip(src);
const res = fillWorkbook(src, rows, summary);
const after = readZip(res.bytes);
ok("same files inside", before.map((e) => e.name).join() === after.map((e) => e.name).join());
for (const name of ["xl/styles.xml", "xl/workbook.xml", "xl/theme/theme1.xml", "[Content_Types].xml"]) ok(`untouched byte for byte: ${name}`, txt(before, name) === txt(after, name));
const s1 = txt(after, "xl/worksheets/sheet1.xml"); // Resumen
const s2 = txt(after, "xl/worksheets/sheet2.xml"); // Reporte detallado

ok("detail: example rows are gone", !s2.includes("A1-20") && !s2.includes("Manuel Rodriguez") && !s2.includes("Felipe no tenía"));
ok("detail: new group in A..G order", /B2-5/.test(cellXml(s2, "C2")) && /B1-6/.test(cellXml(s2, "C3")) && /B2-13/.test(cellXml(s2, "C4")) && /A1-6/.test(cellXml(s2, "C6")));
const ser = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8)) - Date.UTC(1899, 11, 30)) / 86400000);
ok("detail: dates are real dates with the template's date style", cellXml(s2, "A2").includes(`<v>${ser("2026-10-27")}</v>`) && /s="5"/.test(cellXml(s2, "A2")), cellXml(s2, "A2"));
ok("detail: date style also on rows that were empty", /s="\d+"/.test(cellXml(s2, "A5")) && cellXml(s2, "A5").includes(`<v>${ser("2026-10-21")}</v>`), cellXml(s2, "A5"));
ok("detail: time text", cellXml(s2, "B2").includes("De 9 a 10 PM"));
ok("detail: type and requested", cellXml(s2, "D2").includes("Hora Extra") && cellXml(s2, "E2").includes("Felipe") && cellXml(s2, "D4").includes("Colaboración"));
ok("detail: evidence is a clickable link with the template's link style", cellXml(s2, "F2").includes('HYPERLINK("https://drive.google.com/e1"') && /s="6"/.test(cellXml(s2, "F2")), cellXml(s2, "F2"));
ok("detail: no evidence → empty cell", /<c r="F4"[^>]*\/>/.test(cellXml(s2, "F4")), cellXml(s2, "F4"));
ok("detail: special characters are escaped", cellXml(s2, "G2").includes("Felipe &amp; the &quot;power&quot; &lt;cut&gt;") || cellXml(s2, "G2").includes('Felipe &amp; the "power" &lt;cut&gt;'), cellXml(s2, "G2"));
ok("detail: the old links on those cells are gone", !/<hyperlink\b[^>]*ref="F[2-4]"/.test(s2));
ok("detail: used range still covers everything", /<dimension ref="A1:G17"\/>/.test(s2));
ok("detail: column widths kept", /<col width="50"/.test(s2));
ok("detail: banded fills kept on the pre-formatted empty rows (style of row 7 survives)", /s="\d+"/.test(cellXml(s2, "A7")));
const t1 = txt(after, "xl/tables/table1.xml");
ok("table grows to hold 5 rows", /ref="A1:G6"/.test(t1) && !/ref="A1:G4"/.test(t1), t1.slice(0, 200));
ok("table: autoFilter grows too", /<autoFilter ref="A1:G6"/.test(t1));

ok("resumen: teacher (escaped) and month", cellXml(s1, "A3").includes("Max &amp; Co") && cellXml(s1, "B3").includes("Octubre-2026"), cellXml(s1, "A3"));
ok("resumen: numbers are numbers", cellXml(s1, "C3").includes("<v>0</v>") && cellXml(s1, "D3").includes("<v>0</v>") && cellXml(s1, "E3").includes("<v>4</v>") && cellXml(s1, "F3").includes("<v>1</v>"), [cellXml(s1, "C3"), cellXml(s1, "E3")].join(" "));
ok("resumen: cell styles kept", /s="\d+"/.test(cellXml(s1, "A3")) && /s="\d+"/.test(cellXml(s1, "E3")));
ok("resumen: merged title and header untouched", s1.includes("<mergeCells") && s1.includes("RESUMEN DE CLASES EXTRACURRICULARES") && s1.includes("Horas Recuperadas"));
ok("no notes when everything is found", res.notes.length === 0, res.notes.join(" | "));

// ---- a template whose Resumen has formulas: they are kept
const srcF = new Uint8Array(readFileSync("scripts/fixtures/formato-ejemplo-formulas.xlsx"));
const resF = fillWorkbook(srcF, rows.slice(0, 2), summary);
const f1 = txt(readZip(resF.bytes), "xl/worksheets/sheet1.xml");
ok("formula cell is kept", /<f>/.test(cellXml(f1, "E3")) && !cellXml(f1, "E3").includes("<v>4</v>"), cellXml(f1, "E3"));
ok("formula kept → says so", resF.notes.some((n) => /Horas Extra/.test(n) && /formula/i.test(n)), resF.notes.join(" | "));
ok("other Resumen cells still filled", cellXml(f1, "A3").includes("Max &amp; Co") && cellXml(f1, "F3").includes("<v>1</v>"));
const t2 = txt(readZip(resF.bytes), "xl/tables/table1.xml");
ok("table untouched when the rows fit inside it", t2 === txt(before, "xl/tables/table1.xml") || /ref="A1:G4"/.test(t2));

// ---- no classes: sample rows are still cleared and the summary is filled
const none = readZip(fillWorkbook(src, [], { ...summary, extra: 0, collaborations: 0 }).bytes);
ok("no classes: example rows cleared", !txt(none, "xl/worksheets/sheet2.xml").includes("A1-20"));
ok("no classes: Resumen filled", cellXml(txt(none, "xl/worksheets/sheet1.xml"), "A3").includes("Max &amp; Co"));

// ---- the embedded blank template (what "Download the Excel" uses)
const tpl = templateBytes();
const tz = readZip(fillWorkbook(tpl, rows, summary).bytes);
const ts1 = txt(tz, "xl/worksheets/sheet1.xml");
const ts2 = txt(tz, "xl/worksheets/sheet2.xml");
ok("template: Resumen filled", cellXml(ts1, "A3").includes("Max &amp; Co") && cellXml(ts1, "B3").includes("Octubre-2026") && cellXml(ts1, "E3").includes("<v>4</v>"));
ok("template: first and last row land in order", cellXml(ts2, "C2").includes("B2-5") && cellXml(ts2, "C6").includes("A1-6"));
ok("template: dates are real dates", cellXml(ts2, "A2").includes(`<v>${ser("2026-10-27")}</v>`), cellXml(ts2, "A2"));
ok("template: evidence links keep the blue link style of the column", /HYPERLINK/.test(cellXml(ts2, "F2")) && /s="\d+"/.test(cellXml(ts2, "F2")));
ok("template: banded rows still there (empty row below the data keeps its style)", /s="\d+"/.test(cellXml(ts2, "A7")));
ok("template: the table grew from 1 row to 5", /ref="A1:G6"/.test(txt(tz, "xl/tables/table2.xml") || txt(tz, "xl/tables/table1.xml")), tz.map((e) => e.name).filter((n) => n.includes("table")).join());
const empty = fillWorkbook(tpl, [], { ...summary, extra: 0, collaborations: 0 });
ok("template: a month with no classes still gives a valid file", empty.bytes.length > 1000 && empty.notes.length === 0, empty.notes.join("|"));
writeFileSync(join(tmpdir(), "reporte-plantilla-prueba.xlsx"), fillWorkbook(tpl, rows, summary).bytes);

// ---- friendly errors
let msg = "";
try {
  fillWorkbook(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]), rows, summary);
} catch (e) {
  msg = (e as Error).message;
}
ok("error: not an xlsx", /not an \.xlsx/.test(msg), msg);
const renamed = createZip(before.map((e) => (e.name === "xl/workbook.xml" ? { name: e.name, content: new TextEncoder().encode(txt(before, e.name).replace('name="Resumen"', 'name="Hoja1"')) } : e)));
msg = "";
try {
  fillWorkbook(renamed, rows, summary);
} catch (e) {
  msg = (e as Error).message;
}
ok("error: missing tab names the tabs it found", /Resumen/.test(msg) && /Hoja1/.test(msg), msg);

writeFileSync(join(tmpdir(), "relleno-prueba.xlsx"), res.bytes); // to open by hand if you want to look at it
console.log(fail ? `\n${fail} failed, ${pass} passed` : `✅ xlsx-fill: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
