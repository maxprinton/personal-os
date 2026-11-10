// Template Manager phase 3: project profiles and the fill engine (Word, Excel, PowerPoint, PDF, text), tested on
// real files of the generated library (scripts/fixtures/templates) and on PDFs made here.
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  changedKeys, cleanLabel, cleanProfile, fieldForLabel, fieldsForHeading, missingFields, newProfile, resolveValues, sectionText, slotOf, snapshot, valueText, withAnswers, type ProfileData,
} from "@/lib/file-templates/fields";
import { autoItems, cleanMap, fieldsUsed, mapHeaders, mergeMap, scanText, type MapItem } from "@/lib/file-templates/fill/common";
import { fillFile, fillKindOf, scanFile } from "@/lib/file-templates/fill";
import { openZip, readPart } from "@/lib/file-templates/fill/ooxml";
import { pdfGrid } from "@/lib/file-templates/fill/pdf";
import { planFor } from "@/lib/file-templates/filler";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const ok = (name: string, cond: boolean, info?: unknown) => eq(name, cond ? true : info ?? false, true);

const FIX = "scripts/fixtures/templates/";
const file = (n: string) => new Uint8Array(readFileSync(FIX + n));
const part = (bytes: Uint8Array, name: string) => readPart(openZip(bytes), name) ?? "";

const profile: ProfileData = cleanProfile({
  scalars: {
    project_name: { en: "Campus Wi-Fi Upgrade", es: "Mejora del Wi-Fi del campus" },
    project_goal: { en: "Cover 100% of classrooms with stable Wi-Fi by March 2027.", es: "Cubrir el 100% de las aulas con Wi-Fi estable para marzo de 2027." },
    organization: { en: "Colegio Norte" }, sponsor: { en: "Ana Ruiz" }, project_manager: { en: "Maximo Avila" }, prepared_by: { en: "Maximo Avila" },
    approach: { en: "Hybrid", es: "Híbrido" }, start_date: { en: "2026-11-16" }, end_date: { en: "2027-03-31" }, budget: { en: "USD 18,000" },
  },
  lists: {
    scope_in: [{ en: "Survey of all buildings", es: "Estudio de todos los edificios" }, { en: "New access points", es: "Nuevos puntos de acceso" }],
    scope_out: [{ en: "Dorm network", es: "Red de residencias" }],
    success_criteria: [{ en: "Speed test above 50 Mbps in every room" }],
    assumptions: [{ en: "Ceiling access during holidays" }], constraints: [{ en: "Budget cap USD 18,000" }],
  },
  tables: {
    objectives: [{ objective: { en: "Full coverage", es: "Cobertura total" }, measure: { en: "Rooms with signal" }, target: { en: "100%" }, due: { en: "2027-03-31" } }],
    milestones: [{ name: { en: "Site survey done", es: "Estudio terminado" }, date: { en: "2026-12-04" } }, { name: { en: "APs installed" }, date: { en: "2027-02-26" } }, { name: { en: "Handover" }, date: { en: "2027-03-31" } }],
    risks: [{ risk: { en: "Vendor delays the hardware" }, owner: { en: "Maximo Avila" }, response: { en: "Order early; backup vendor" } }, { risk: { en: "Classes disrupted by install work" }, owner: { en: "Ana Ruiz" }, response: { en: "Install on weekends" } }],
    stakeholders: [{ name: { en: "Teachers" }, role: { en: "Users" }, interest: { en: "High" }, influence: { en: "Medium" } }],
    team: [{ name: { en: "Luis Gómez" }, role: { en: "Network tech" }, email: { en: "luis@example.com" } }],
  },
});
const EN = resolveValues(profile, "en", { today: "2026-11-09" });
const ES = resolveValues(profile, "es", { today: "2026-11-09" });

// ------------------------------------------------------------------------------------------ fields
eq("clean label", cleanLabel("Interest (1-5):"), "interest");
eq("label to field", [fieldForLabel("Nombre del proyecto"), fieldForLabel("Project Sponsor:"), fieldForLabel("Fecha de inicio"), fieldForLabel("Banana")], ["project_name", "sponsor", "start_date", null]);
eq("heading: numbered", fieldsForHeading("9. High-level risks"), ["risks"]);
eq("heading: two fields", fieldsForHeading("8. Assumptions and constraints"), ["assumptions", "constraints"]);
eq("heading: spanish pair", fieldsForHeading("Supuestos y restricciones"), ["assumptions", "constraints"]);
eq("heading: scope", fieldsForHeading("Scope"), ["scope_in", "scope_out"]);
eq("heading: unknown part", fieldsForHeading("Purpose and justification"), null);
eq("bilingual pick + fallback", [EN.scalars.project_name, ES.scalars.project_name, ES.scalars.sponsor], ["Campus Wi-Fi Upgrade", "Mejora del Wi-Fi del campus", "Ana Ruiz"]);
eq("spanish list falls back per item", ES.lists.success_criteria, ["Speed test above 50 Mbps in every room"]);
eq("list as text", valueText(EN, "scope_out"), "• Dorm network");
eq("table as text", valueText(EN, "milestones").split("\n")[0], "Site survey done — 2026-12-04");
eq("section text, two fields", sectionText(ES, ["assumptions", "constraints"]), "Supuestos:\n• Ceiling access during holidays\nRestricciones:\n• Budget cap USD 18,000");
eq("auto date + version", [EN.scalars.date, EN.scalars.version], ["2026-11-09", "1.0"]);
eq("slot of shared vs bilingual", [slotOf("sponsor", "es"), slotOf("project_goal", "es"), slotOf("risks", "es", "owner"), slotOf("risks", "es", "risk")], ["en", "es", "en", "es"]);
const fresh = newProfile(cleanProfile({ scalars: { organization: { en: "Colegio Norte" }, budget: { en: "USD 1" } } }), "Library move", "es");
eq("new profile takes My details, not other fields", [fresh.scalars.organization, fresh.scalars.budget, fresh.scalars.project_name], [{ en: "Colegio Norte" }, undefined, { es: "Library move" }]);
const answered = withAnswers(fresh, "es", { sponsor: "Rector", scope_in: "- Libros\n- Estantes\n", date: "2020-01-01", project_goal: "Mudar la biblioteca" });
eq("answers into profile", [answered.scalars.sponsor, answered.lists.scope_in, answered.scalars.date, answered.scalars.project_goal], [{ en: "Rector" }, [{ es: "Libros" }, { es: "Estantes" }], undefined, { es: "Mudar la biblioteca" }]);
eq("missing fields", missingFields(["project_name", "sponsor", "date", "ask:Notes", "risks"], resolveValues(fresh, "en")), ["sponsor", "risks"]);
const snap = snapshot(EN, ["sponsor", "milestones", "date", "version"]);
eq("snapshot leaves out date and version", Object.keys(snap), ["milestones", "sponsor"]);
const changed = cleanProfile(JSON.parse(JSON.stringify(profile)));
changed.scalars.sponsor = { en: "Carla Mena" };
eq("out of date keys", changedKeys(snap, snapshot(resolveValues(changed, "en"), Object.keys(snap))), ["sponsor"]);
eq("clean profile drops junk", cleanProfile({ scalars: { sponsor: "  Ana ", nope: "x" }, lists: { scope_in: ["", "A"] }, tables: { risks: [{ risk: "R", bogus: "x" }, {}] } }), { scalars: { sponsor: { en: "Ana" } }, lists: { scope_in: [{ en: "A" }] }, tables: { risks: [{ risk: { en: "R" } }] } });

// ------------------------------------------------------------------------------------------ blanks in text
const t1 = scanText("Project: [Project Name]  Sponsor: ____  See [the guide](http://x) <br> {{double braces}} <<Client>>");
eq("scan text", t1.map((t) => [t.token, t.field]), [["[Project Name]", "project_name"], ["<<Client>>", "customer"], ["Sponsor: ____", "sponsor"]]);
eq("underscore keeps its label", t1.find((t) => t.field === "sponsor")?.keep, "Sponsor: ");
eq("unknown bracket asks", scanText("[Vendor contact]")[0].field, "ask:Vendor contact");
eq("known-only brackets", scanText("A[Start] --> B[Vendor]", { brackets: "known" }).map((t) => t.field), ["start_date"]);
const risksHead = mapHeaders(["ID", "Risk (cause → event → effect)", "Category", "Probability (1-5)", "Impact (1-5)", "Score", "Response", "Response actions", "Owner"]);
eq("risk table header", [risksHead?.field, risksHead?.cols.map((c) => c.sub)], ["risks", ["risk", "response", "owner"]]);
eq("signature table is skipped", mapHeaders(["Name", "Role", "Signature", "Date"]), null);
eq("list-column table", mapHeaders(["In scope", "Out of scope"])?.cols.map((c) => c.field), ["scope_in", "scope_out"]);
const saved: MapItem[] = [{ kind: "token", token: "[Project Name]", field: null, label: "Project Name", sure: true }];
eq("saved choice wins on rescan", mergeMap(saved, t1)[0].field, null);
eq("clean map", cleanMap([{ kind: "token", token: "{{x}}", field: "evil" }, { kind: "pdf_spot", page: 0, x: 140, y: 5, size: 99, field: "sponsor", label: "S" }, { kind: "nope" }]), [
  { kind: "token", token: "{{x}}", field: null, label: "Blank", sure: true },
  { kind: "pdf_spot", page: 1, x: 100, y: 5, size: 36, field: "sponsor", label: "S", sure: true },
]);
eq("kinds", ["a.DOCX", "b.xlsm", "c.mmd", "d.png"].map(fillKindOf), ["docx", "xlsx", "mmd", null]);

(async () => {
  // ---------------------------------------------------------------------------------------- Word
  const charter = file("charter-en.docx");
  const ci = await scanFile("charter.docx", charter);
  eq("charter: tables", ci.filter((i) => i.kind === "table").map((i) => i.field), ["objectives", "scope_in", "milestones", "stakeholders"]);
  eq("charter: sections", ci.filter((i) => i.kind === "section" && i.field).map((i) => i.field), ["success_criteria", "budget", "assumptions", "risks"]);
  ok("charter: unknown sections are offered, not filled", ci.some((i) => i.kind === "section" && i.label === "Governance" && i.field === null));
  ok("charter: no {{double braces}} blank", !ci.some((i) => i.label === "double braces"));
  const auto = autoItems(ci);
  const plan = planFor(auto, resolveValues(fresh, "en"), "docx", false);
  ok("plan lists what the profile lacks", plan.missing.includes("sponsor") && plan.missing.includes("risks") && !plan.missing.includes("organization"), plan.missing);
  const r1 = { filled: 0, skipped: [] as string[] };
  const out1 = await fillFile("charter.docx", charter, auto, EN, r1);
  const doc1 = part(out1, "word/document.xml");
  ok("charter: no known {{fields}} left", !/\{\{(project_name|sponsor|budget|date|version|organization)\}\}/.test(doc1), doc1.match(/\{\{\w+\}\}/g));
  ok("charter: values written", ["Campus Wi-Fi Upgrade", "Ana Ruiz", "Full coverage", "Dorm network", "Site survey done", "2027-02-26", "Teachers", "Budget cap USD 18,000", "Vendor delays the hardware"].every((s) => doc1.includes(s)));
  ok("charter: guidance replaced in filled sections", !doc1.includes("Top three to five risks known today"));
  ok("charter: guidance kept where nothing was filled", doc1.includes("Who approves what"));
  eq("charter: same number of tables", (doc1.match(/<w:tbl>/g) ?? []).length, (part(charter, "word/document.xml").match(/<w:tbl>/g) ?? []).length);
  ok("charter: header filled too", part(out1, "word/header1.xml").includes("Campus Wi-Fi Upgrade") || !part(charter, "word/header1.xml").includes("{{project_name}}"));
  ok("charter: report", r1.filled > 20 && r1.skipped.length === 0, r1);
  const es = file("charter-es.docx");
  const out2 = await fillFile("acta.docx", es, autoItems(await scanFile("acta.docx", es)), ES, { filled: 0, skipped: [] });
  const doc2 = part(out2, "word/document.xml");
  ok("spanish charter gets Spanish text", doc2.includes("Mejora del Wi-Fi del campus") && doc2.includes("Red de residencias") && doc2.includes("Ana Ruiz"));
  const empty = { filled: 0, skipped: [] as string[] };
  const out3 = await fillFile("charter.docx", charter, auto, resolveValues(fresh, "en"), empty);
  ok("empty values leave blanks and are reported", part(out3, "word/document.xml").includes("{{sponsor}}") && empty.skipped.includes("Sponsor"), empty.skipped);

  // ---------------------------------------------------------------------------------------- Excel
  const reg = file("risks-en.xlsx");
  const xi = await scanFile("risks.xlsx", reg);
  const tbl = xi.find((i) => i.kind === "table");
  eq("register: table at row 4", tbl && tbl.kind === "table" ? [tbl.field, tbl.header, tbl.cols.map((c) => c.col)] : null, ["risks", 4, [1, 7, 8]]);
  const out4 = await fillFile("risks.xlsx", reg, autoItems(xi), EN, { filled: 0, skipped: [] });
  const sheet = part(out4, "xl/worksheets/sheet2.xml");
  const row5 = /<row r="5"[\s\S]*?<\/row>/.exec(sheet)?.[0] ?? "";
  ok("register: example row overwritten", row5.includes("Vendor delays the hardware") && !row5.includes("R-01") && row5.includes("Order early"), row5.slice(0, 400));
  ok("register: example row restyled like the rows below", /<c r="B5" s="15"/.test(row5), row5.slice(0, 300));
  ok("register: score formula kept", /<c r="F5"[^>]*><f/.test(row5));
  ok("register: second risk in row 6", /<row r="6"[\s\S]*?Classes disrupted[\s\S]*?<\/row>/.test(sheet));
  ok("register: title filled", part(out4, "xl/sharedStrings.xml").includes("Campus Wi-Fi Upgrade") && !part(out4, "xl/sharedStrings.xml").includes("{{project_name}}"));
  ok("register: recalculates on open", part(out4, "xl/workbook.xml").includes('fullCalcOnLoad="1"'));

  // ---------------------------------------------------------------------------------------- PowerPoint
  const deck = file("plan-en.pptx");
  const pi = await scanFile("plan.pptx", deck);
  eq("plan on a page: boxes", pi.filter((i) => i.kind === "section").map((i) => i.field), ["scope_in", "success_criteria", "milestones", "team", "risks"]);
  const out5 = await fillFile("plan.pptx", deck, autoItems(pi), EN, { filled: 0, skipped: [] });
  const s3 = part(out5, "ppt/slides/slide3.xml");
  ok("plan on a page: filled", ["Campus Wi-Fi Upgrade", "Site survey done — 2026-12-04", "In scope:", "Luis Gómez", "Cover 100% of classrooms"].every((x) => s3.includes(x)), s3.slice(0, 200));
  ok("plan on a page: hint text gone", !s3.includes("Three risks, owner, response."));

  // ---------------------------------------------------------------------------------------- text
  const md = file("iteration-en.md");
  const mi = await scanFile("it.md", md);
  ok("markdown: no H1 title section", !mi.some((i) => i.kind === "section" && i.heading.startsWith("Iteration Planning")));
  const outMd = new TextDecoder().decode(await fillFile("it.md", md, autoItems(mi), EN, { filled: 0, skipped: [] }));
  ok("markdown: goal section and fields", outMd.includes("## 2. Goal\n\nCover 100% of classrooms") && outMd.includes("**Project:** Campus Wi-Fi Upgrade"), outMd.slice(0, 300));
  const csv = new TextEncoder().encode("Milestone,Date,Status\n,,\n");
  const ciCsv = await scanFile("m.csv", csv);
  const outCsv = new TextDecoder().decode(await fillFile("m.csv", csv, ciCsv, EN, { filled: 0, skipped: [] }));
  eq("csv: table rows", outCsv, "Milestone,Date,Status\nSite survey done,2026-12-04,\nAPs installed,2027-02-26,\nHandover,2027-03-31,\n");
  const mmd = new TextEncoder().encode('flowchart LR\n  A["{{project_name}}"] --> B[Start]\n');
  const outMmd = new TextDecoder().decode(await fillFile("d.mmd", mmd, await scanFile("d.mmd", mmd), { ...EN, scalars: { ...EN.scalars, project_name: 'Wi-Fi "v2" [beta]' } }, { filled: 0, skipped: [] }));
  ok("mermaid stays valid", outMmd.includes('A["Wi-Fi  v2   beta "]'), outMmd);

  // ---------------------------------------------------------------------------------------- PDF
  const form = await PDFDocument.create();
  const page = form.addPage([595, 842]);
  const f = form.getForm();
  f.createTextField("ProjectName").addToPage(page, { x: 50, y: 760, width: 300, height: 20 });
  f.createTextField("txtSponsor").addToPage(page, { x: 50, y: 720, width: 300, height: 20 });
  f.createTextField("Vendor_contact").addToPage(page, { x: 50, y: 680, width: 300, height: 20 });
  const formBytes = await form.save();
  const fi = await scanFile("form.pdf", formBytes);
  eq("pdf form: fields matched by name", fi.map((i) => i.field), ["project_name", "sponsor", "ask:Vendor contact"]);
  const filledForm = await fillFile("form.pdf", formBytes, fi, { ...EN, scalars: { ...EN.scalars, project_name: "Wi-Fi → año 2027", "ask:Vendor contact": "Luis" } }, { filled: 0, skipped: [] });
  const back = (await PDFDocument.load(filledForm)).getForm();
  eq("pdf form: values (unsupported characters swapped)", [back.getTextField("ProjectName").getText(), back.getTextField("txtSponsor").getText(), back.getTextField("Vendor_contact").getText()], ["Wi-Fi -> año 2027", "Ana Ruiz", "Luis"]);
  const flat = await PDFDocument.create();
  flat.addPage([595, 842]).drawText("Charter", { x: 50, y: 800, size: 14, font: await flat.embedFont(StandardFonts.Helvetica) });
  const flatBytes = await flat.save();
  eq("flat pdf: nothing found", await scanFile("flat.pdf", flatBytes), []);
  const spots: MapItem[] = [{ kind: "pdf_spot", page: 1, x: 10, y: 10, size: 11, field: "project_name", label: "Project", sure: true }, { kind: "pdf_spot", page: 1, x: 10, y: 20, size: 10, field: "scope_in", label: "Scope", sure: true }];
  const rep = { filled: 0, skipped: [] as string[] };
  const flatOut = await fillFile("flat.pdf", flatBytes, spots, EN, rep);
  ok("flat pdf: spots written", rep.filled === 2 && flatOut.length > flatBytes.length, rep);
  ok("grid preview", (await pdfGrid(flatBytes, spots as Extract<MapItem, { kind: "pdf_spot" }>[])).length > flatBytes.length);
  eq("fields used", fieldsUsed(spots), ["project_name", "scope_in"]);

  console.log(`${fail ? "✗" : "✓"} template fill: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
