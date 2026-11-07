// Portfolio add-on, Phase 1: slot rules, status, form parsing, note linking ("Former ·") and the note property.
// Fake database: nothing is sent.
// Run: npm run test:portfolio-core
import { cleanLangs, isSingleton, keyFor, keyProblem, nextPosition, pathFor, renameKey, slugify, slugProblem, slugTaken, sortSlots } from "@/lib/portfolio/slots";
import { computeStatus, canPublish } from "@/lib/portfolio/status";
import { sourceHash } from "@/lib/portfolio/publish/hash";
import { parseLangs, parseLinks, parseMeta, parseStack, parseWords } from "@/lib/portfolio/forms";
import { createLinkedNote, createSlot, deleteSlot, formerTitle, linkNote, loadSlotViews, unlinkNote, updateSlot } from "@/lib/portfolio/link";
import { BUILTINS } from "@/lib/notes-db/builtins";
import { READONLY_TYPES, type DbNote, type NoteProperty } from "@/lib/notes-db/types";
import { displayText, rawValue } from "@/lib/notes-db/values";
import { ADDONS, addonById } from "@/lib/addons/registry";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ---- Fake Supabase: select / insert / update / delete with eq, is, in, not, order, limit, single, count ----
type Row = Record<string, unknown>;
let idc = 0;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let ins: Row[] | null = null;
    let del = false;
    let head = false;
    const run = () => {
      if (ins) {
        const made = ins.map((r) => ({ id: `id${++idc}`, created_at: "", updated_at: "", ...r }));
        rows.push(...made);
        return { data: made.map((r) => ({ ...r })), error: null as null | { message: string } };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        for (const r of hit) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (del) {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      return { data: head ? null : hit.map((r) => ({ ...r })), error: null, count: hit.length };
    };
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (r: Row | Row[]) => ((ins = Array.isArray(r) ? r : [r]), q),
      update: (p: Row) => ((patch = p), q),
      delete: () => ((del = true), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      not: (k: string, _op: string, v: unknown) => (filters.push((r) => (r[k] ?? null) !== v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      single: async () => {
        const r = run();
        return { data: r.data?.[0] ?? null, error: r.data?.[0] ? null : { message: "no row" } };
      },
      then: (res: (x: unknown) => void) => res(run()),
    };
    return q;
  };
  return { from } as never;
}

// ---- Add-on registry ----
ok("registry has portfolio", !!addonById("portfolio") && addonById("portfolio")!.href === "/portfolio");
ok("g p is only used once", ADDONS.filter((a) => a.key === "p").length === 1);

// ---- Slugs and keys ----
ok("slugify accents", slugify("Mi Proyecto Ñandú!") === "mi-proyecto-nandu", slugify("Mi Proyecto Ñandú!"));
ok("slugify trims hyphens", slugify("  --Hello  World-- ") === "hello-world");
ok("slugify empty", slugify("¡¡¡") === "");
ok("slug ok", slugProblem("personal-os") === null);
ok("slug empty", !!slugProblem(""));
ok("slug upper", !!slugProblem("Personal"));
ok("slug double hyphen", !!slugProblem("a--b"));
ok("slug reserved", !!slugProblem("api"));
ok("slug too long", !!slugProblem("a".repeat(61)));
ok("singletons", isSingleton("home") && isSingleton("now") && !isSingleton("project"));
ok("singleton key is the kind", keyFor("about", "whatever") === "about" && keyProblem("about", "about") === null);
ok("project key from name", keyFor("project", "My App") === "my-app");
ok("project key empty", !!keyProblem("project", ""));
ok("paths", pathFor({ kind: "project", key: "os", langs: {} }, "en") === "/projects/os" && pathFor({ kind: "article", key: "a", langs: { es: { slug: "hola" } } }, "es") === "/writing/hola" && pathFor({ kind: "about", key: "about", langs: {} }, "es") === "/about");
ok("rename before publish forgets the old key", renameKey({ key: "a", previous_keys: [] }, "b", false).previous_keys.length === 0);
ok("rename after publish keeps the old key", renameKey({ key: "a", previous_keys: ["z"] }, "b", true).previous_keys.join() === "z,a");
ok("rename back: the new key is never its own old key", renameKey({ key: "b", previous_keys: ["a"] }, "a", true).previous_keys.join() === "b");
const sl = [
  { id: "1", kind: "project" as const, key: "a", position: 1, featured: false, archived: false, langs: {} },
  { id: "2", kind: "project" as const, key: "b", position: 2, featured: true, archived: false, langs: { en: { slug: "bee" } } },
  { id: "3", kind: "about" as const, key: "about", position: 1, featured: false, archived: false, langs: {} },
];
ok("next position", nextPosition(sl, "project") === 3 && nextPosition(sl, "article") === 1);
ok("sort: kind order then featured", sortSlots(sl).map((s) => s.id).join() === "3,2,1", sortSlots(sl).map((s) => s.id).join());
ok("slug taken", slugTaken(sl, null, "project", "en", "bee")?.id === "2" && slugTaken(sl, "2", "project", "en", "bee") === null && slugTaken(sl, null, "project", "es", "bee") === null);
ok("cleanLangs", JSON.stringify(cleanLangs({ en: { slug: " x ", summary: "", junk: "no" }, fr: { slug: "y" } })) === '{"en":{"slug":"x"}}');

// ---- Status ----
const note = (over = {}) => ({ id: "n", title: "T", icon: null, updated_at: "2026-11-01T10:00:00Z", deleted_at: null, ...over });
const pub = (over = {}) => ({ version: 1, is_live: true, published_at: "2026-11-01T10:00:00Z", slug: "x", source_hash: null, ...over });
ok("status no note", computeStatus(null, null) === "no_note");
ok("status draft", computeStatus(note(), null) === "draft");
ok("status published", computeStatus(note(), pub()) === "published");
ok("status changed by time", computeStatus(note({ updated_at: "2026-11-02T10:00:00Z" }), pub()) === "changed");
ok("status tolerance", computeStatus(note({ updated_at: "2026-11-01T10:00:03Z" }), pub()) === "published");
ok("status unpublished", computeStatus(note(), pub({ is_live: false })) === "unpublished");
ok("status trashed", computeStatus(note({ deleted_at: "2026-11-03T00:00:00Z" }), pub()) === "trashed");
ok("status hash same", computeStatus(note({ updated_at: "2026-12-01T00:00:00Z" }), pub({ source_hash: "h" }), "h") === "published");
ok("status hash differs", computeStatus(note(), pub({ source_hash: "h" }), "other") === "changed");
ok("live page stays when the note is unlinked", computeStatus(null, pub()) === "published");
ok("can publish", canPublish("draft") && canPublish("changed") && canPublish("unpublished") && !canPublish("published") && !canPublish("no_note") && !canPublish("trashed"));

// ---- Form parsing ----
ok("stack", parseStack("React, next.js ,, REACT, Supabase").join() === "React,next.js,Supabase");
ok("links", JSON.stringify(parseLinks("Code | https://github.com/x/y\nhttps://www.example.com/a\njavascript:alert(1)\nbad")) === '[{"label":"Code","url":"https://github.com/x/y"},{"label":"example.com","url":"https://www.example.com/a"}]');
ok("words", parseWords("Acme, ACME\nsecret ").join() === "acme,secret");
{
  const f = (o: Record<string, string>) => (k: string) => o[k] ?? "";
  const m = parseMeta(f({ status: "shipped", year_from: "2025", stack: "A, B", video: "https://youtu.be/dQw4w9WgXcQ" }));
  ok("meta ok", "meta" in m && m.meta.status === "shipped" && m.meta.year_from === 2025 && m.meta.video === "dQw4w9WgXcQ" && m.meta.stack?.length === 2);
  ok("meta bad year", "error" in parseMeta(f({ year_from: "1800" })));
  ok("meta end before start", "error" in parseMeta(f({ year_from: "2026", year_to: "2025" })));
  ok("meta bad video", "error" in parseMeta(f({ video: "not a video" })));
  ok("meta ignores unknown status", "meta" in m && !("meta" in parseMeta(f({}))) === false && (parseMeta(f({ status: "x" })) as { meta: { status?: string } }).meta.status === undefined);
  const l = parseLangs(f({ en_slug: "hi", es_summary: " hola " }));
  ok("langs", l.en?.slug === "hi" && l.es?.summary === "hola");
}

// ---- Slots and links against a fake database ----
const tables: Record<string, Row[]> = { portfolio_slots: [], notes: [], portfolio_pages: [], portfolio_page_versions: [] };
const sb = fakeDb(tables);
const U = "u1";
const about = await createSlot(sb, U, { kind: "about" });
ok("create about", about.ok && tables.portfolio_slots[0].key === "about");
ok("about is unique", !(await createSlot(sb, U, { kind: "about" })).ok);
const p1 = await createSlot(sb, U, { kind: "project", name: "Personal OS" });
ok("create project", p1.ok && tables.portfolio_slots[1].key === "personal-os");
ok("project key clash", !(await createSlot(sb, U, { kind: "project", name: "personal os" })).ok);
ok("project needs a name", !(await createSlot(sb, U, { kind: "project", name: "" })).ok);
const aboutId = (about as { id: string }).id;
const projId = (p1 as { id: string }).id;
ok("rename project", (await updateSlot(sb, U, projId, { key: "My OS" })).ok && tables.portfolio_slots[1].key === "my-os");
ok("cannot rename singleton", !(await updateSlot(sb, U, aboutId, { key: "other" })).ok);
ok("slug clash is refused", (await updateSlot(sb, U, projId, { langs: { en: { slug: "x" } } })).ok);
const p2 = await createSlot(sb, U, { kind: "project", name: "Second" });
ok("duplicate slug in same language refused", !(await updateSlot(sb, U, (p2 as { id: string }).id, { langs: { en: { slug: "x" } } })).ok);
ok("same slug in other language is fine", (await updateSlot(sb, U, (p2 as { id: string }).id, { langs: { es: { slug: "x" } } })).ok);
ok("bad slug refused", !(await updateSlot(sb, U, projId, { langs: { en: { slug: "Bad Slug" } } })).ok);

// notes
tables.notes.push(
  { id: "n1", user_id: U, title: "About me EN", block_name: null, is_template: false, deleted_at: null, portfolio_slot_id: null, portfolio_lang: null, updated_at: "2026-11-01T00:00:00Z" },
  { id: "n2", user_id: U, title: "About me v2", block_name: null, is_template: false, deleted_at: null, portfolio_slot_id: null, portfolio_lang: null, updated_at: "2026-11-02T00:00:00Z" },
  { id: "nb", user_id: U, title: "Gym", block_name: "Gym", is_template: false, deleted_at: null, portfolio_slot_id: null, portfolio_lang: null },
  { id: "nt", user_id: U, title: "Tpl", block_name: null, is_template: true, deleted_at: null, portfolio_slot_id: null, portfolio_lang: null },
  { id: "nx", user_id: U, title: "Trashed", block_name: null, is_template: false, deleted_at: "2026-11-01", portfolio_slot_id: null, portfolio_lang: null },
);
const note1 = () => tables.notes.find((n) => n.id === "n1")!;
ok("link a note", (await linkNote(sb, U, { slotId: aboutId, lang: "en", noteId: "n1" })).ok && note1().portfolio_slot_id === aboutId && note1().portfolio_lang === "en");
ok("link again is a no-op", (await linkNote(sb, U, { slotId: aboutId, lang: "en", noteId: "n1" })).ok);
ok("block note refused", !(await linkNote(sb, U, { slotId: aboutId, lang: "es", noteId: "nb" })).ok);
ok("template refused", !(await linkNote(sb, U, { slotId: aboutId, lang: "es", noteId: "nt" })).ok);
ok("trashed note refused", !(await linkNote(sb, U, { slotId: aboutId, lang: "es", noteId: "nx" })).ok);
ok("note already used elsewhere refused", !(await linkNote(sb, U, { slotId: projId, lang: "en", noteId: "n1" })).ok);
const noReplace = await linkNote(sb, U, { slotId: aboutId, lang: "en", noteId: "n2" });
ok("replacing needs confirmation", !noReplace.ok && note1().portfolio_slot_id === aboutId);
const rep = await linkNote(sb, U, { slotId: aboutId, lang: "en", noteId: "n2", replace: true });
ok("replace works", rep.ok && (rep as { released?: string }).released === "n1");
ok("old note is a normal note again", note1().portfolio_slot_id === null && note1().portfolio_lang === null);
ok("old note is called Former", /^Former · About · en · [A-Z][a-z]{2} \d{1,2}$/.test(String(note1().title)), String(note1().title));
ok("former title format", formerTitle("my-os", "es", "2026-11-07") === "Former · my-os · es · Nov 7");
ok("new note is linked", tables.notes.find((n) => n.id === "n2")!.portfolio_slot_id === aboutId);

const created = await createLinkedNote(sb, U, { slotId: aboutId, lang: "es" });
ok("create linked note", created.ok && tables.notes.some((n) => n.title === "About" && n.portfolio_lang === "es"));
ok("only one note per language", !(await createLinkedNote(sb, U, { slotId: aboutId, lang: "es" })).ok);

// views and statuses
{
  tables.portfolio_pages.push({ slot_id: aboutId, lang: "en", version: 1, is_live: true, published_at: "2026-11-05T00:00:00Z", slug: "about", user_id: U });
  const aboutRow = tables.portfolio_slots.find((x) => x.id === aboutId)! as { kind: string; meta: unknown; langs: Record<string, unknown> };
  const n2 = tables.notes.find((n) => n.id === "n2")! as { title: string; content?: string; page?: { icon?: string } };
  const liveHash = sourceHash({ title: n2.title, content: n2.content ?? "", page: n2.page ?? null }, aboutRow, "en");
  tables.portfolio_page_versions.push({ slot_id: aboutId, lang: "en", version: 1, source_hash: liveHash, action: "publish", user_id: U });
  const { slots } = await loadSlotViews(sb, U);
  const a = slots.find((s) => s.id === aboutId)!;
  ok("view: published page is live and unchanged", a.pages.en.status === "published", a.pages.en.status);
  ok("view: spanish is a draft", a.pages.es.status === "draft", a.pages.es.status);
  const pr = slots.find((s) => s.id === projId)!;
  ok("view: project has no notes", pr.pages.en.status === "no_note" && pr.pages.es.status === "no_note");
  ok("view: slots sorted (about before project)", slots[0].kind === "about");
  tables.notes.find((n) => n.id === "n2")!.deleted_at = "2026-11-06";
  const again = (await loadSlotViews(sb, U)).slots.find((s) => s.id === aboutId)!;
  ok("view: note in trash", again.pages.en.status === "trashed", again.pages.en.status);
  tables.notes.find((n) => n.id === "n2")!.deleted_at = null;
  // change detection by fingerprint: editing the note text (even with an old timestamp) makes it "changed"
  tables.notes.find((n) => n.id === "n2")!.content = "edited after publishing";
  const edited = (await loadSlotViews(sb, U)).slots.find((s) => s.id === aboutId)!;
  ok("view: edited note is 'changed' by hash", edited.pages.en.status === "changed", edited.pages.en.status);
  tables.notes.find((n) => n.id === "n2")!.content = n2.content ?? "";
  aboutRow.langs = { ...aboutRow.langs, en: { summary: "new summary" } };
  ok("view: editing the slot's texts is 'changed' too", (await loadSlotViews(sb, U)).slots.find((s) => s.id === aboutId)!.pages.en.status === "changed");
  aboutRow.langs = {};
}

// unlink, archive, delete
ok("unlink keeps the note", (await unlinkNote(sb, U, { slotId: aboutId, lang: "es" })).ok && tables.notes.filter((n) => n.portfolio_lang === "es").length === 0 && tables.notes.some((n) => n.title === "About"));
ok("cannot delete a published slot", !(await deleteSlot(sb, U, aboutId)).ok);
ok("can delete a never-published slot", (await deleteSlot(sb, U, projId)).ok && !tables.portfolio_slots.some((s) => s.id === projId));
ok("archive", (await updateSlot(sb, U, aboutId, { archived: true })).ok && (await loadSlotViews(sb, U)).slots.every((s) => s.id !== aboutId) && (await loadSlotViews(sb, U, { includeArchived: true })).slots.some((s) => s.id === aboutId));
ok("restore blocked by a live slot of the same key", await (async () => {
  tables.portfolio_slots.push({ id: "dupe", user_id: U, kind: "about", key: "about", archived: false, previous_keys: [], meta: {}, langs: {}, position: 0, featured: false });
  const r = await updateSlot(sb, U, aboutId, { archived: false });
  tables.portfolio_slots.splice(tables.portfolio_slots.findIndex((s) => s.id === "dupe"), 1);
  return !r.ok;
})());

// ---- The Portfolio property on notes ----
const def = BUILTINS.find((b) => b.key === "portfolio");
ok("Portfolio is a hidden built-in", !!def && def.type === "portfolio" && def.hidden === true);
ok("Portfolio is read only", READONLY_TYPES.includes("portfolio"));
{
  const prop: NoteProperty = { id: "pp", key: "portfolio", name: "Portfolio", type: "portfolio", config: {}, position: 0, hidden: true, builtin: true };
  const base: DbNote = { id: "n", title: "x", icon: null, cover: null, parentId: null, blockName: null, kind: "page" as const, seq: 1, createdAt: "", updatedAt: "", templateId: null, values: {}, tags: [] as never[], relations: {}, wordCount: 0, openTodos: 0, backlinks: 0, text: "", content: "" };
  const linked: DbNote = { ...base, portfolio: "About · EN" };
  const plain: DbNote = { ...base };
  ok("property value", rawValue(linked, prop, [prop]) === "About · EN" && rawValue(plain, prop, [prop]) === null);
  ok("property text", displayText(linked, prop, [prop]) === "About · EN");
}

console.log(`${fail ? "❌" : "✅"} portfolio core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
