// Template Manager add-on: search, filters, sorting, catalog import planning, edit validation, file names.
import { catalogRows, cleanPatch, displayName, aboutIn, EMPTY_FILTERS, filterTemplates, formatFromName, groupByPhase, nameFromFile, planImport, safeName, sortTemplates, storagePath, trashDaysLeft, fileUrl, sha256Hex, editableKind, copyFileName, copyPath, nextVersion, sortVersions, fillText, rowsToCsv, squareRows, mermaidBlock } from "@/lib/file-templates/query";
import { addonById } from "@/lib/addons/registry";
import type { FileTemplate } from "@/lib/file-templates/types";

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

const base: FileTemplate = {
  id: "00000000-0000-0000-0000-000000000001", code: null, name: "x", name_es: null, phase: null, grp: "other", format: "other", approaches: [], doc_type: null,
  tags: [], status: "ready", favorite: false, rating: null, source: null, source_url: null, about: {}, notes: null, times_used: 0, last_used_at: null,
  deleted_at: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", tm_files: [],
};
const mk = (o: Partial<FileTemplate>): FileTemplate => ({ ...base, ...o });
const list = [
  mk({ id: "a", code: "PLN-12", name: "Risk Register", name_es: "Registro de riesgos", phase: "PLN", grp: "base", format: "xlsx", about: { en: { best: "Listing every risk" }, es: { best: "Listar cada riesgo" } }, times_used: 3 }),
  mk({ id: "b", code: "INI-04", name: "Project Charter", name_es: "Acta de constitución del proyecto", phase: "INI", grp: "base", format: "docx", favorite: true, created_at: "2026-11-05T00:00:00Z" }),
  mk({ id: "c", code: "DMA-17", name: "FMEA", phase: "PLN", grp: "dmaic", format: "xlsx", tags: ["Six Sigma"] }),
  mk({ id: "d", code: "INI-10", name: "Late charter", phase: "INI", grp: "base", format: "docx" }),
  mk({ id: "e", code: null, name: "My own checklist", phase: null, grp: "other", format: "pdf", status: "inbox", tm_files: [{ id: "f", template_id: "e", lang: null, role: "original", storage_path: "u/templates/e/file-x.pdf", file_name: "cliente-acme.pdf", mime: null, size: 1, sha256: null, created_at: "" }] }),
];

// search
const ids = (l: FileTemplate[]) => l.map((t) => t.id);
eq("search code", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "pln-12" })), ["a"]);
eq("search spanish name accent-free", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "constitucion" })), ["b"]);
eq("search about text", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "every risk" })), ["a"]);
eq("search tag", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "six sigma" })), ["c"]);
eq("search file name", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "acme" })), ["e"]);
eq("all words must match", ids(filterTemplates(list, { ...EMPTY_FILTERS, q: "risk charter" })), []);
// filters
eq("phase filter", ids(filterTemplates(list, { ...EMPTY_FILTERS, phase: "INI" })), ["b", "d"]);
eq("group filter", ids(filterTemplates(list, { ...EMPTY_FILTERS, grp: "dmaic" })), ["c"]);
eq("format filter", ids(filterTemplates(list, { ...EMPTY_FILTERS, format: "xlsx" })), ["a", "c"]);
eq("favorites", ids(filterTemplates(list, { ...EMPTY_FILTERS, favorites: true })), ["b"]);
eq("status inbox", ids(filterTemplates(list, { ...EMPTY_FILTERS, status: "inbox" })), ["e"]);
// sort
eq("phase sort: phase, then base before dmaic, natural codes, no phase last", ids(sortTemplates(list, "phase")), ["b", "d", "a", "c", "e"]);
eq("name sort spanish", ids(sortTemplates(list, "name", "es")).slice(0, 2), ["b", "c"]);
eq("recent", ids(sortTemplates(list, "recent"))[0], "b");
eq("most used", ids(sortTemplates(list, "used"))[0], "a");
eq("group by phase", groupByPhase(sortTemplates(list, "phase")).map((g) => [g.phase, g.items.length]), [["INI", 2], ["PLN", 2], [null, 1]]);
// display
eq("display es", displayName(list[1], "es"), "Acta de constitución del proyecto");
eq("display es fallback", displayName(list[2], "es"), "FMEA");
eq("about fallback to other language", aboutIn(mk({ about: { en: { best: "B", use: "U" }, es: { best: "BE" } } }), "es"), { best: "BE", use: "U" });
// files
eq("format docx", formatFromName("a.DOCX"), "docx");
eq("format mmd", formatFromName("map.mmd"), "mermaid");
eq("format unknown", formatFromName("x.zip"), "other");
eq("name from library file", nameFromFile("INI-04 Project Charter.docx"), "Project Charter");
eq("name from own file", nameFromFile("risk_register v2.xlsx"), "risk register v2");
eq("safe name", safeName("Acta de constitución (v1).docx"), "Acta-de-constitucion-v1-.docx");
eq("storage path", storagePath("u1", "t1", "es", "Árbol CTQ.md"), "u1/templates/t1/es-Arbol-CTQ.md");
eq("file url encodes", fileUrl("u1/templates/t1/en-a b.docx", true), "/api/files/u1/templates/t1/en-a%20b.docx?download");
eq("trash days left", trashDaysLeft("2026-11-01T00:00:00Z", new Date("2026-11-11T00:00:00Z")), 20);
eq("trash days due", trashDaysLeft("2026-09-01T00:00:00Z", new Date("2026-11-11T00:00:00Z")), 0);
// catalog
const cat = {
  templates: [
    { id: "INI-04", format: "docx", phase: "INI", group: "base", approaches: ["all"], references: ["PMI"], name_en: "Project Charter", name_es: "Acta", best_en: "Starting", best_es: "Iniciar", use_en: "Always" },
    { id: "SCR-08", format: "mermaid", phase: "PLN", group: "scrum", name_en: "User Story Map" },
    { id: "INI-04", format: "docx", phase: "INI", group: "base", name_en: "Duplicate" },
    { id: "bad id", name_en: "x" },
    { id: "ZZ-01", format: "weird", phase: "XX", group: "nope", name_en: "Odd" },
  ],
};
const cr = catalogRows(cat);
eq("catalog valid count (dupes and bad ids dropped)", cr.rows.map((r) => r.code), ["INI-04", "SCR-08", "ZZ-01"]);
eq("catalog row", cr.rows[0], { code: "INI-04", name: "Project Charter", name_es: "Acta", phase: "INI", grp: "base", format: "docx", approaches: ["all"], about: { en: { best: "Starting", use: "Always", refs: "PMI" }, es: { best: "Iniciar", refs: "PMI" } }, source: "Personal OS Template Library" });
eq("catalog unknown values", [cr.rows[2].phase, cr.rows[2].grp, cr.rows[2].format], [null, "other", "other"]);
eq("catalog missing list", catalogRows({}).error !== undefined, true);
const plan = planImport(["INI-04", "SCR-08"], [
  "Template Library/EN/01 Initiating/INI-04 Project Charter.docx",
  "Template Library/ES/01 Iniciación/INI-04 Acta de constitución del proyecto.docx",
  "Template Library/EN/06 Approach-specific/Scrum and Agile/SCR-08 User Story Map.md",
  "Template Library/EN/06 Approach-specific/Scrum and Agile/SCR-08 User Story Map.mmd",
  "Template Library/catalog.json",
  "Template Library/README.md",
  "Template Library/_generator/engine.py",
  "Template Library/EN/02 Planning/PLN-99 Unknown.docx",
  "Template Library/EN/.DS_Store",
]);
eq("plan files", plan.files.map((p) => [p.code, p.lang, p.index]), [["INI-04", "en", 0], ["INI-04", "es", 1], ["SCR-08", "en", 2], ["SCR-08", "en", 3]]);
eq("plan skipped only unknown", plan.skipped, ["Template Library/EN/02 Planning/PLN-99 Unknown.docx"]);
// edits
eq("patch drops unknown keys", cleanPatch({ user_id: "x", times_used: 9 }), null);
eq("patch empty name ignored", cleanPatch({ name: "  " }), null);
eq("patch values", cleanPatch({ name: " A ", phase: "MON", grp: "lean", status: "ready", rating: 4, favorite: true, tags: "a, B, a , b", source_url: "https://x.y/z" }),
  { name: "A", phase: "MON", grp: "lean", status: "ready", favorite: true, rating: 4, tags: ["a", "B"], source_url: "https://x.y/z" });
eq("patch rejects bad values", cleanPatch({ phase: "XYZ", grp: "nope", status: "done", rating: 9, source_url: "javascript:alert(1)" }), null);
eq("patch clears", cleanPatch({ phase: "", rating: null, name_es: "", source_url: "" }), { name_es: null, phase: null, rating: null, source_url: null });
eq("patch about keeps refs", cleanPatch({ about: { en: { best: "B", refs: "R", junk: 1 }, fr: { best: "no" } } }), { about: { en: { best: "B", refs: "R" } } });
// registry
eq("add-on registered", addonById("templates")?.href, "/templates");
eq("add-on key l", addonById("templates")?.key, "l");

// phase 2: working copies
eq("editable csv", editableKind("a.CSV"), "csv");
eq("editable mmd", editableKind("map.mmd"), "mermaid");
eq("editable md", editableKind("notes.md"), "text");
eq("not editable docx", editableKind("x.docx"), null);
eq("copy file name", copyFileName("Risk Register · Booking app", "PLN-12 Risk Register.xlsx"), "Risk-Register-Booking-app.xlsx");
eq("copy file name drops typed extension", copyFileName("Plan.v2.docx", "a.docx"), "Plan-v2.docx");
eq("copy path", copyPath("u", "t", "c", "Plan v2.docx", 123), "u/templates/t/copies/c/123-Plan-v2.docx");
eq("next version empty", nextVersion([]), 1);
eq("next version", nextVersion([{ version: 1 }, { version: 3 }, { version: null }]), 4);
eq("sort versions", sortVersions([{ version: 1, created_at: "a" }, { version: 2, created_at: "b" }]).map((v) => v.version), [2, 1]);
eq("fill text", fillText("# {{project_name}} – {{ date }} {{unknown}} {{sponsor}}", { project_name: "Booking app", date: "2026-11-10", sponsor: "" }), "# Booking app – 2026-11-10 {{unknown}} {{sponsor}}");
eq("rows to csv", rowsToCsv([["a", "b,c"], ['say "hi"', "x\ny"]]), 'a,"b,c"\r\n"say ""hi""","x\ny"\r\n');
eq("square rows", squareRows([["a"], ["b", "c", "d"]]), [["a", "", ""], ["b", "c", "d"]]);
eq("mermaid block", mermaidBlock("# T\n\n```mermaid\nflowchart LR\n A-->B\n```\n"), "flowchart LR\n A-->B");
eq("no mermaid block", mermaidBlock("plain"), null);

(async () => {
  eq("sha256", await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  console.log(`${fail ? "✗" : "✓"} file templates: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
