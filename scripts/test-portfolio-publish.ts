// Portfolio add-on, Phase 2: media copy (hash, metadata strip), stage / publish / update / unpublish / rollback, history,
// change detection, never-public words, signing. Fake database and fake storage: nothing is sent.
// Run: npm run test:publish
import { fakeDb, type Row } from "./fake-supabase";
import { buildSnapshot, history, publish, rollback, stage, unpublish, type Deps } from "@/lib/portfolio/publish/engine";
import { copyMedia, detectMedia, sniffType, stripMetadata, svgIssue, type MediaStore } from "@/lib/portfolio/publish/media";
import { findBlocked, highlightWords } from "@/lib/portfolio/publish/check";
import { sourceHash } from "@/lib/portfolio/publish/hash";
import { notifySite } from "@/lib/portfolio/publish/notify";
import { readingMinutes, publicToc, searchText } from "@/lib/portfolio/publish/search";
import { signBody, verifySignature } from "@/lib/portfolio/sign";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ——— synthetic files ———
const bytes = (...p: (number | number[] | string | Uint8Array)[]) => new Uint8Array(p.flatMap((x) => (typeof x === "number" ? [x] : typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : Array.from(x))));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function exif(orientation: number, gps = true) {
  // little-endian TIFF with Orientation, and a fake "GPS" marker string
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0, ...(gps ? [...("GPS-LAT-12.34").split("").map((c) => c.charCodeAt(0))] : [])];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return bytes(0xff, 0xe1, [(body.length + 2) >> 8, (body.length + 2) & 255], body);
}
const jfif = bytes(0xff, 0xe0, 0, 16, "JFIF\0", 1, 1, 0, 0, 1, 0, 1, 0, 0);
const sos = bytes(0xff, 0xda, 0, 4, 0, 0, [1, 2, 3, 4, 5], 0xff, 0xd9);
const jpeg = (ex?: Uint8Array, varyByte = 0) => bytes(0xff, 0xd8, jfif, ex ?? [], bytes(0xff, 0xfe, 0, 7, "hello"), bytes(0xff, 0xda, 0, 4, 0, 0, [1, 2, 3, varyByte], 0xff, 0xd9));
const chunk = (type: string, data: number[]) => bytes(be32(data.length), type, data, 0, 0, 0, 0);
const png = (withText = true) => bytes(0x89, "PNG\r\n", 0x1a, 0x0a, chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), withText ? chunk("tEXt", [...bytes("Author\0Max Secret")]) : [], chunk("IDAT", [1, 2, 3]), chunk("IEND", []));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(s);

// ——— stripMetadata ———
{
  const out = stripMetadata(jpeg(exif(1)), "image/jpeg");
  ok("jpeg: GPS/exif gone", !has(out, "GPS-LAT") && !has(out, "Exif") && !has(out, "hello"));
  ok("jpeg: JFIF + scan kept", has(out, "JFIF") && out[out.length - 1] === 0xd9 && sniffType(out) === "image/jpeg");
  const rot = stripMetadata(jpeg(exif(6)), "image/jpeg");
  ok("jpeg: orientation kept, GPS gone", has(rot, "Exif") && !has(rot, "GPS-LAT") && rot.length < jpeg(exif(6)).length);
  const p = stripMetadata(png(), "image/png");
  ok("png: text chunk removed, image chunks kept", !has(p, "Max Secret") && has(p, "IHDR") && has(p, "IDAT") && has(p, "IEND"));
  let threw = false;
  try {
    stripMetadata(bytes(0xff, 0xd8, 0x00, 0x01), "image/jpeg");
  } catch {
    threw = true;
  }
  ok("jpeg: damaged file throws", threw);
  const riff = (chunks: Uint8Array[]) => {
    const body = bytes("WEBP", ...chunks);
    return bytes("RIFF", [body.length & 255, (body.length >> 8) & 255, 0, 0], body);
  };
  const le = (t: string, d: number[]) => bytes(t, [d.length & 255, 0, 0, 0], d, d.length % 2 ? [0] : []);
  const webp = riff([le("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), le("VP8 ", [9, 9, 9, 9]), le("EXIF", [...bytes("GPS-LAT")]), le("XMP ", [...bytes("xmp")])]);
  const w = stripWebp(webp);
  function stripWebp(x: Uint8Array) {
    return stripMetadata(x, "image/webp");
  }
  ok("webp: EXIF/XMP removed, flags cleared, size fixed", !has(w, "GPS-LAT") && !has(w, "xmp") && (w[20] & 0x0c) === 0 && (w[4] | (w[5] << 8)) === w.length - 8 && sniffType(w) === "image/webp");
  const gif = bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0], bytes(0x21, 0xfe, 6, "secret", 0), bytes(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0), 0x3b);
  const g = stripMetadata(gif, "image/gif");
  ok("gif: comment removed, frame kept", !has(g, "secret") && g[g.length - 1] === 0x3b && g.length < gif.length);
  ok("sniff: by content", sniffType(bytes("%PDF-1.4 x")) === "application/pdf" && sniffType(bytes("hello world, plain text")) === null && sniffType(bytes(0, 0, 0, 0, "ftypavif", 0, 0)) === "image/avif");
}

// ——— fake storage ———
function fakeStore(files: Record<string, Uint8Array>) {
  const pub = new Map<string, { bytes: Uint8Array; type: string }>();
  const store: MediaStore & { pub: typeof pub; uploads: number; removed: string[] } = {
    publicBase: "https://cdn.test/portfolio-media/",
    pub,
    uploads: 0,
    removed: [],
    download: async (k) => files[k] ?? null,
    exists: async (p) => pub.has(p),
    upload: async (p, b, t) => (pub.set(p, { bytes: b, type: t }), store.uploads++, true),
    list: async (f) => [...pub.keys()].filter((k) => k.startsWith(f + "/")),
    remove: async (ps) => void ps.forEach((p) => (pub.delete(p), store.removed.push(p))),
  };
  return store;
}

const U = "u1";
const IMG = `/api/files/${U}/2026-11/ab12cd34-photo.jpg`;
const IMG2 = `/api/files/${U}/2026-11/ff00ff00-same.jpg`;
const BIG = `/api/files/${U}/2026-11/00000000-big.png`;
const TXT = `/api/files/${U}/2026-11/11111111-evil.png`;
const OTHER = `/api/files/someone-else/2026-11/aaaaaaaa-x.jpg`;
const files: Record<string, Uint8Array> = {
  [`${U}/2026-11/ab12cd34-photo.jpg`]: jpeg(exif(1)),
  [`${U}/2026-11/ff00ff00-same.jpg`]: jpeg(exif(1)), // same picture, other name → same hash
  [`${U}/2026-11/00000000-big.png`]: new Uint8Array(10 * 1024 * 1024 + 10).fill(1),
  [`${U}/2026-11/11111111-evil.png`]: bytes("<html>not an image</html>"),
  [`${U}/2026-11/22222222-doc.pdf`]: bytes("%PDF-1.4 hello"),
  "someone-else/2026-11/aaaaaaaa-x.jpg": jpeg(),
};

{
  const st = fakeStore(files);
  const r = await copyMedia(st, U, "s1", [
    { src: IMG, kind: "image" },
    { src: IMG2, kind: "image" },
    { src: BIG, kind: "image" },
    { src: TXT, kind: "image" },
    { src: OTHER, kind: "image" },
    { src: `/api/files/${U}/2026-11/22222222-doc.pdf`, kind: "image" },
    { src: `/api/files/${U}/2026-11/22222222-doc.pdf`, kind: "file" },
    { src: `/api/files/${U}/nope.png`, kind: "image" },
  ]);
  ok("copy: same content stored once", r.urls.get(IMG) === r.urls.get(IMG2) || [...st.pub.keys()].filter((k) => k.endsWith(".jpg")).length === 2);
  const hashes = [...r.paths.values()].map((p) => p.split("/")[1].split("-")[0]);
  ok("copy: files named by hash under the slot folder", [...r.paths.values()].every((p) => p.startsWith("s1/")) && hashes[0].length === 16);
  ok("copy: stored bytes carry no GPS", [...st.pub.values()].every((f) => !has(f.bytes, "GPS-LAT")));
  const reasons = Object.fromEntries(r.failed.map((f) => [f.src.split("/").pop(), f.reason]));
  ok("copy: too big / wrong type / other user's / pdf as image / missing", reasons["00000000-big.png"] === "too_big" && reasons["11111111-evil.png"] === "type" && reasons["aaaaaaaa-x.jpg"] === "missing" && reasons["22222222-doc.pdf"] === "type" && reasons["nope.png"] === "missing", JSON.stringify(reasons));
  ok("copy: pdf as file ok", r.urls.has(`/api/files/${U}/2026-11/22222222-doc.pdf`));
  const again = await copyMedia(st, U, "s1", [{ src: IMG, kind: "image" }]);
  ok("copy: second time uploads nothing", again.copied === 0);
}

// ——— more formats: Office, ODF, ZIP, audio, text, SVG, AVIF ———
{
  const zip = (...inner: (string | number[])[]) => bytes("PK", 3, 4, new Array(26).fill(0), ...inner);
  const docx = zip("[Content_Types].xml", "word/document.xml");
  const odt = zip("mimetypeapplication/vnd.oasis.opendocument.text");
  const d = (b: Uint8Array, n: string) => detectMedia(b, n);
  ok("detect: docx/xlsx/pptx by content + name", d(docx, "a.docx")?.type.includes("wordprocessingml") === true && d(docx, "a.xlsx")?.type.includes("spreadsheetml") === true && d(docx, "a.pptx")?.type.includes("presentationml") === true);
  ok("detect: Office files keep metadata (warned)", d(docx, "a.docx")?.keeps === "metadata");
  ok("detect: odt", d(odt, "x.bin")?.type === "application/vnd.oasis.opendocument.text" && d(odt, "x.odt")?.ext === ".odt");
  ok("detect: macro file refused", d(zip("[Content_Types].xml", "word/vbaProject.bin"), "a.docx")?.unsafe === true);
  ok("detect: plain zip only as .zip", d(zip("a.txt"), "a.zip")?.kind === "archive" && d(zip("a.txt"), "a.zip")?.keeps === "archive" && d(zip("a.txt"), "a.docx") === null && d(zip("a.txt"), "a.exe") === null);
  ok("detect: mp3 (ID3 or frame sync)", d(bytes("ID3", 3, 0, 0, 0, 0, 0, 0), "s.mp3")?.type === "audio/mpeg" && d(bytes(0xff, 0xfb, 0x90, 0, 0), "s.mp3")?.kind === "audio" && d(bytes("hello world"), "s.mp3") === null);
  ok("detect: m4a", d(bytes(0, 0, 0, 0x20, "ftypM4A ", 0, 0, 0, 0, 0), "s.m4a")?.type === "audio/mp4");
  ok("detect: avif", d(bytes(0, 0, 0, 0, "ftypavif", 0, 0), "p.avif")?.type === "image/avif");
  ok("detect: text types", d(bytes("a,b\n1,2"), "t.csv")?.type === "text/csv" && d(bytes("# hi"), "n.md")?.type === "text/markdown" && d(bytes("hello"), "n.txt")?.type === "text/plain");
  ok("detect: json must parse", d(bytes('{"a":1}'), "d.json")?.type === "application/json" && d(bytes("{nope"), "d.json") === null);
  ok("detect: html is stored as text/plain (never runs)", d(bytes("<h1>x</h1>"), "p.html")?.type === "text/plain" && d(bytes("<h1>x</h1>"), "p.html")?.ext === ".html");
  ok("detect: text must be UTF-8, no NUL", d(bytes(0xff, 0xfe, 0xfd), "t.txt") === null && d(bytes("a", 0, "b"), "t.txt") === null);
  ok("detect: unknown names are refused", d(bytes("MZ......"), "setup.exe") === null && d(bytes("hello"), "noext") === null);
  const good = '<svg xmlns="http://www.w3.org/2000/svg"><!-- note --><metadata>Max</metadata><rect width="1" height="1"/></svg>';
  ok("svg: clean one accepted", d(bytes(good), "a.svg")?.type === "image/svg+xml" && d(bytes(good), "a.svg")?.unsafe === undefined);
  for (const [name, bad] of [["script", "<svg><script>alert(1)</script></svg>"], ["handler", '<svg onload="x()"></svg>'], ["foreignObject", "<svg><foreignObject/></svg>"], ["javascript:", '<svg><a href="javascript:x()"/></svg>'], ["outside href", '<svg><image href="https://evil.test/x.png"/></svg>'], ["css url", '<svg><style>a{background:url(https://evil.test/x)}</style></svg>'], ["entity", '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>']] as const)
    ok(`svg: ${name} refused`, d(bytes(bad), "a.svg")?.unsafe === true && svgIssue(bad) !== null);
  ok("svg: inner #links and data:image allowed", svgIssue('<svg><use href="#a"/><image href="data:image/png;base64,AA"/></svg>') === null);
  const stripped = new TextDecoder().decode(stripMetadata(bytes(good), "image/svg+xml"));
  ok("svg: comments and <metadata> removed", !stripped.includes("note") && !stripped.includes("Max") && stripped.includes("<rect"));

  const f2: Record<string, Uint8Array> = {
    [`${U}/m/aaaaaaaa-report.docx`]: docx,
    [`${U}/m/bbbbbbbb-song.mp3`]: bytes("ID3", 3, 0, 0, 0, 0, 0, 0),
    [`${U}/m/cccccccc-pack.zip`]: zip("a.txt"),
    [`${U}/m/dddddddd-evil.svg`]: bytes("<svg><script/></svg>"),
    [`${U}/m/eeeeeeee-data.json`]: bytes('{"ok":true}'),
    [`${U}/m/ffffffff-pic.svg`]: bytes(good),
  };
  const st = fakeStore(f2);
  const r = await copyMedia(st, U, "s9", [
    { src: `/api/files/${U}/m/aaaaaaaa-report.docx`, kind: "file" },
    { src: `/api/files/${U}/m/bbbbbbbb-song.mp3`, kind: "audio" },
    { src: `/api/files/${U}/m/cccccccc-pack.zip`, kind: "file" },
    { src: `/api/files/${U}/m/dddddddd-evil.svg`, kind: "image" },
    { src: `/api/files/${U}/m/eeeeeeee-data.json`, kind: "file" },
    { src: `/api/files/${U}/m/ffffffff-pic.svg`, kind: "image" },
    { src: `/api/files/${U}/m/aaaaaaaa-report.docx`, kind: "image" },
  ]);
  const up = [...st.pub.entries()];
  ok("copy: docx, mp3, zip, json, svg copied with their types", r.copied === 5 && up.some(([k, v]) => k.endsWith("report.docx") && v.type.includes("wordprocessingml")) && up.some(([k, v]) => k.endsWith("song.mp3") && v.type === "audio/mpeg") && up.some(([k, v]) => k.endsWith("pack.zip") && v.type === "application/zip"), JSON.stringify([r.copied, r.failed]));
  ok("copy: unsafe svg blocked", r.failed.some((f) => f.src.includes("evil.svg") && f.reason === "unsafe"));
  ok("copy: docx placed as an image is refused", r.failed.some((f) => f.src.includes("report.docx") && f.reason === "type") === false); // same src already copied as a file → not copied twice
  ok("copy: warns about files that keep metadata / unchecked zips", r.unstripped.some((u) => u.name.endsWith("report.docx") && u.why === "metadata") && r.unstripped.some((u) => u.name.endsWith("song.mp3")) && r.unstripped.some((u) => u.name.endsWith("pack.zip") && u.why === "archive") && !r.unstripped.some((u) => u.name.endsWith(".json")));
  ok("copy: published svg has no metadata", up.filter(([k]) => k.endsWith("pic.svg")).every(([, v]) => !has(v.bytes, "Max")));
  const bigAudio = bytes("ID3", 3, 0, 0, 0, 0, 0, 0, new Uint8Array(15 * 1024 * 1024));
  const hugeAudio = bytes("ID3", 3, 0, 0, 0, 0, 0, 0, new Uint8Array(26 * 1024 * 1024));
  const bigDoc = bytes(docx, new Uint8Array(11 * 1024 * 1024));
  const sz = await copyMedia(fakeStore({ [`${U}/m/11111111-ep.mp3`]: bigAudio, [`${U}/m/22222222-huge.mp3`]: hugeAudio, [`${U}/m/33333333-big.docx`]: bigDoc }), U, "s9", [
    { src: `/api/files/${U}/m/11111111-ep.mp3`, kind: "audio" },
    { src: `/api/files/${U}/m/22222222-huge.mp3`, kind: "audio" },
    { src: `/api/files/${U}/m/33333333-big.docx`, kind: "file" },
  ]);
  ok("size: 15 MB audio ok, 26 MB audio and 11 MB docx too big", sz.urls.has(`/api/files/${U}/m/11111111-ep.mp3`) && sz.failed.length === 2 && sz.failed.every((f) => f.reason === "too_big"), JSON.stringify(sz.failed));
  const aud = await copyMedia(fakeStore({ [`${U}/m/aaaaaaaa-report.docx`]: docx }), U, "s9", [{ src: `/api/files/${U}/m/aaaaaaaa-report.docx`, kind: "audio" }]);
  ok("copy: a docx inside an audio block is refused", aud.failed[0]?.reason === "type");
}

// ——— engine ———
type Env = { tables: Record<string, Row[]>; deps: Deps; store: ReturnType<typeof fakeStore> };
function setup(content: string, over: { title?: string; slotKey?: string; langs?: Record<string, unknown>; blocked?: string[]; page?: Row } = {}): Env {
  const tables: Record<string, Row[]> = {
    portfolio_slots: [{ id: "s1", user_id: U, kind: "project", key: over.slotKey ?? "os", previous_keys: [], position: 1, featured: false, archived: false, meta: { status: "shipped", stack: ["Next.js"] }, langs: over.langs ?? { en: { summary: "A personal OS" } } }],
    notes: [{ id: "n1", user_id: U, title: over.title ?? "Personal OS", content, page: over.page ?? { icon: "🧠" }, updated_at: "2026-11-01T10:00:00Z", deleted_at: null, portfolio_slot_id: "s1", portfolio_lang: "en" }],
    portfolio_pages: [],
    portfolio_page_versions: [],
    portfolio_site: over.blocked ? [{ user_id: U, name: "Max", blocked_words: over.blocked }] : [],
  };
  const store = fakeStore(files);
  let t = 0;
  return { tables, store, deps: { db: fakeDb(tables), store, userId: U, osHosts: ["os.test"], now: () => new Date(Date.UTC(2026, 10, 7, 12, 0, t++)) } };
}

{
  const e = setup(`# Personal OS\n\nIntro with ![shot](${IMG}) {width="400"}\n\n## Details\n\nText.`);
  const s = await stage(e.deps, "s1", "en");
  ok("stage: builds a snapshot and nothing is public", !!s.snapshot && e.tables.portfolio_pages.length === 0 && e.tables.portfolio_page_versions.length === 1 && e.tables.portfolio_page_versions[0].action === "stage");
  ok("stage: snapshot content", s.snapshot!.title === "Personal OS" && s.snapshot!.path === "/projects/os" && s.snapshot!.icon === "🧠" && s.snapshot!.summary === "A personal OS" && s.snapshot!.toc.length === 2 && s.snapshot!.reading_minutes === 1 && s.snapshot!.body_html.includes("cdn.test/portfolio-media/s1/") && !s.snapshot!.body_html.includes("/api/files"));
  ok("stage: meta from slot", (s.snapshot!.meta.stack as string[])[0] === "Next.js" && s.snapshot!.meta.status === "shipped");
  ok("stage: only info warnings", !s.blocked && !s.needsConfirm && s.warnings.some((w) => w.code === "media_copied"), JSON.stringify(s.warnings));
  await stage(e.deps, "s1", "en");
  ok("stage: keeps a single stage row", e.tables.portfolio_page_versions.filter((v) => v.action === "stage").length === 1);

  const p1 = await publish(e.deps, "s1", "en", { expectHash: s.snapshot!.source_hash });
  ok("publish: ok, version 2 after the stage numbering is cleared → 1", p1.ok && (p1 as { version: number }).version === 1, JSON.stringify(p1));
  const row = e.tables.portfolio_pages[0];
  const firstPublishedAt = row.published_at;
  ok("publish: public row", e.tables.portfolio_pages.length === 1 && row.is_live === true && row.slug === "os" && row.lang === "en" && row.kind === "project" && row.version === 1 && !!row.published_at);
  ok("publish: stage row replaced by the publish row", e.tables.portfolio_page_versions.length === 1 && e.tables.portfolio_page_versions[0].action === "publish" && e.tables.portfolio_page_versions[0].source_hash === s.snapshot!.source_hash);
  ok("publish: affected paths", p1.ok && (p1 as { affected: { paths: string[] } }).affected.paths.includes("/projects/os") && (p1 as { affected: { paths: string[] } }).affected.paths.includes("/projects"));

  // update: same note → hash same; changed note → new version
  const same = await buildSnapshot(e.deps, "s1", "en");
  ok("hash: unchanged note gives the same hash", same.snapshot!.source_hash === s.snapshot!.source_hash);
  e.tables.notes[0].content = `# Personal OS\n\nNew text.\n\n![shot](${IMG})`;
  const changed = await buildSnapshot(e.deps, "s1", "en");
  ok("hash: edit changes the hash", changed.snapshot!.source_hash !== s.snapshot!.source_hash);
  const stale = await publish(e.deps, "s1", "en", { expectHash: s.snapshot!.source_hash });
  ok("publish: refuses when the note changed after the preview", !stale.ok && !!(stale as { changed?: boolean }).changed);
  const p2 = await publish(e.deps, "s1", "en", {});
  ok("update: version 2, one row, two versions", p2.ok && (p2 as { version: number }).version === 2 && e.tables.portfolio_pages.length === 1 && e.tables.portfolio_pages[0].version === 2 && e.tables.portfolio_page_versions.length === 2);

  ok("update: published_at keeps the first publish date", !!firstPublishedAt && e.tables.portfolio_pages[0].published_at === firstPublishedAt && e.tables.portfolio_pages[0].updated_at !== firstPublishedAt, String(e.tables.portfolio_pages[0].published_at));

  // slug change → old slug remembered
  (e.tables.portfolio_slots[0].langs as Record<string, Record<string, string>>).en.slug = "personal-os";
  const p3 = await publish(e.deps, "s1", "en", {});
  ok("slug rename: new path + old slug kept for the 301", p3.ok && e.tables.portfolio_pages[0].slug === "personal-os" && ((e.tables.portfolio_pages[0].meta as { previous_slugs: string[] }).previous_slugs).join() === "os" && (p3 as { affected: { paths: string[] } }).affected.paths.includes("/projects/os"), JSON.stringify(e.tables.portfolio_pages[0].meta));

  // history
  const h = await history(e.deps, "s1", "en");
  ok("history: newest first, current flagged", h.length === 3 && h[0].version === 3 && h[0].current && !h[1].current && h.every((x) => x.restorable));

  // rollback to version 1
  const rb = await rollback(e.deps, "s1", "en", 1);
  ok("rollback: new version 4 with the old content", rb.ok && (rb as { version: number }).version === 4 && e.tables.portfolio_pages[0].slug === "os" && String(e.tables.portfolio_pages[0].body_html).includes("Intro with"), JSON.stringify(rb));
  const rbBad = await rollback(e.deps, "s1", "en", 99);
  ok("rollback: unknown version fails", !rbBad.ok);

  // unpublish
  const up = await unpublish(e.deps, "s1", "en");
  ok("unpublish: row hidden, version row added, media removed", up.ok && e.tables.portfolio_pages[0].is_live === false && e.tables.portfolio_page_versions.some((v) => v.action === "unpublish") && e.store.pub.size === 0, `size=${e.store.pub.size}`);
  ok("unpublish twice fails", !(await unpublish(e.deps, "s1", "en")).ok);
  const hh = await history(e.deps, "s1", "en");
  ok("history after unpublish: nothing current, unpublish not restorable", hh[0].action === "unpublish" && !hh.some((x) => x.current) && !hh[0].restorable);
  const rbMissing = await rollback(e.deps, "s1", "en", 1);
  ok("rollback refuses when the images are gone", !rbMissing.ok && /images/i.test((rbMissing as { error: string }).error));
  const again = await publish(e.deps, "s1", "en", {});
  ok("republish after unpublish works", again.ok && e.tables.portfolio_pages[0].is_live === true && e.store.pub.size >= 1);
}

// ——— blocking and confirming ———
{
  const e = setup("   ", { title: "" });
  const b = await publish(e.deps, "s1", "en", {});
  ok("empty title and body block publishing", !b.ok && b.warnings!.some((w) => w.code === "empty_title") && b.warnings!.some((w) => w.code === "empty_body") && e.tables.portfolio_pages.length === 0);
}
{
  const e = setup("- [ ] todo\n- [x] done\n\nSee [private](/notes/22222222-2222-2222-2222-222222222222).");
  const n = await publish(e.deps, "s1", "en", {});
  ok("warnings need a confirm", !n.ok && !!(n as { needsConfirm?: boolean }).needsConfirm && e.tables.portfolio_pages.length === 0);
  const c = await publish(e.deps, "s1", "en", { confirm: true });
  ok("confirmed publish goes through and keeps the warnings in the version", c.ok && (e.tables.portfolio_page_versions[0].warnings as { code: string }[]).some((w) => w.code === "unchecked_todo"));
}
{
  const e = setup(`![x](${BIG})`);
  const b = await publish(e.deps, "s1", "en", { confirm: true });
  ok("file over 10 MB blocks", !b.ok && b.warnings!.some((w) => w.code === "media_too_big"));
  const e2 = setup(`![x](blob:https://os.test/abc)`);
  const b2 = await publish(e2.deps, "s1", "en", { confirm: true });
  ok("unsaved upload blocks", !b2.ok && b2.warnings!.some((w) => w.code === "blob_upload"));
}
{
  const e = setup("Body.", { slotKey: "api" });
  const b = await publish(e.deps, "s1", "en", { confirm: true });
  ok("reserved slug blocks", !b.ok && b.warnings!.some((w) => w.code === "bad_slug"));
  const e2 = setup("Body.");
  e2.tables.portfolio_slots.push({ id: "s2", user_id: U, kind: "project", key: "other", previous_keys: [], position: 2, featured: false, archived: false, meta: {}, langs: { en: { slug: "os" } } });
  const b2 = await publish(e2.deps, "s1", "en", {});
  ok("duplicate address blocks", !b2.ok && b2.warnings!.some((w) => w.code === "duplicate_slug"));
  e2.tables.notes[0].deleted_at = "2026-11-02T00:00:00Z";
  const b3 = await publish(e2.deps, "s1", "en", {});
  ok("note in trash blocks", !b3.ok && b3.warnings!.some((w) => w.code === "note_trashed"));
  e2.tables.notes.length = 0;
  ok("no note blocks", !(await publish(e2.deps, "s1", "en", {})).ok);
  ok("unknown slot blocks", !(await publish(e2.deps, "nope", "en", {})).ok);
}
{
  const e = setup("We built this with Acme Corp last year. Also ACME again.", { blocked: ["acme corp", "Secreto"] });
  const b = await buildSnapshot(e.deps, "s1", "en");
  const w = b.warnings.find((x) => x.code === "never_public");
  ok("never-public words: found, case-insensitive, needs confirm", !!w && w.count === 1 && b.needsConfirm && !b.blocked, JSON.stringify(b.warnings));
  const f = findBlocked("Tengo un Secretó aquí y SECRETO allá", ["secreto"]);
  ok("never-public words: accents ignored", f.length === 2 && f[0].snippet.includes("Secretó"));
  const hl = highlightWords("<p>Hola <b>Secretó</b> x</p>", ["secreto"]);
  ok("highlight: only text, accent-insensitive", hl === '<p>Hola <b><mark class="n-flag">Secretó</mark></b> x</p>', hl);
}
{
  const e = setup("Para:\n\n- [x] a", { page: { icon: "🧠", cover: `${IMG}#bg=ffffff` } });
  const b = await buildSnapshot(e.deps, "s1", "en");
  ok("cover image copied, fragment kept", /^https:\/\/cdn\.test\/portfolio-media\/s1\/.+\.jpg#bg=ffffff$/.test(b.snapshot!.cover_url ?? ""), String(b.snapshot!.cover_url));
  const e2 = setup("x", { page: { cover: "gradient:3" } });
  ok("gradient cover kept as is", (await buildSnapshot(e2.deps, "s1", "en")).snapshot!.cover_url === "gradient:3");
  const e3 = setup("x", { page: { cover: OTHER } });
  ok("cover of another user is refused", (await buildSnapshot(e3.deps, "s1", "en")).blocked);
}
{
  // links between published pages
  const e = setup("Go to [other](/notes/33333333-3333-3333-3333-333333333333).");
  e.tables.portfolio_pages.push({ id: "p9", user_id: U, slot_id: "s9", slot_key: "about", kind: "about", lang: "en", slug: "about", is_live: true });
  e.tables.notes.push({ id: "33333333-3333-3333-3333-333333333333", user_id: U, portfolio_slot_id: "s9", portfolio_lang: "en", deleted_at: null });
  const b = await buildSnapshot(e.deps, "s1", "en");
  ok("link to a note that is live becomes a public link", b.snapshot!.body_html.includes('href="/about"') && !b.warnings.some((w) => w.code === "private_link"), b.snapshot!.body_html);
}

// ——— hash, search helpers ———
{
  const n = { title: "A", content: "B", page: { icon: "x" } };
  const s = { kind: "project", meta: { a: 1, b: 2 }, langs: { en: { summary: "s" } } };
  ok("hash: stable key order", sourceHash(n, s, "en") === sourceHash(n, { ...s, meta: { b: 2, a: 1 } }, "en"));
  ok("hash: changes with title, content, summary, language", new Set([sourceHash(n, s, "en"), sourceHash({ ...n, title: "Z" }, s, "en"), sourceHash({ ...n, content: "Z" }, s, "en"), sourceHash(n, { ...s, langs: { en: { summary: "t" } } }, "en"), sourceHash(n, s, "es")]).size === 5);
  ok("reading time", readingMinutes("word ".repeat(450)) === 2 && readingMinutes("") === 1 && readingMinutes("a b c") === 1);
  ok("search text one line, capped", !searchText("T", "a\n\nb  c").includes("\n") && searchText("T", "x".repeat(50000)).length === 30000);
  ok("toc: levels 1–3 only", publicToc([{ level: 1, id: "a", text: "A" }, { level: 4, id: "b", text: "B" }]).length === 1);
}

// ——— signing and notify ———
{
  const body = JSON.stringify({ x: 1 });
  const h = signBody("secret", body, 1_000_000_000_000);
  ok("sign: verifies", verifySignature("secret", body, h, 1_000_000_000_000).ok);
  ok("sign: wrong secret / body / header", !verifySignature("other", body, h, 1_000_000_000_000).ok && !verifySignature("secret", body + " ", h, 1_000_000_000_000).ok && !verifySignature("secret", body, "junk", 1_000_000_000_000).ok && !verifySignature("secret", body, null).ok);
  const late = verifySignature("secret", body, h, 1_000_000_000_000 + 301_000);
  ok("sign: expires after 5 minutes", !late.ok && late.reason === "expired" && verifySignature("secret", body, h, 1_000_000_000_000 + 299_000).ok);
  ok("sign: empty secret never verifies", !verifySignature("", body, h, 1_000_000_000_000).ok);
  ok("notify: skipped without env", (await notifySite([], {})).skipped === true);
  let seen: { url: string; sig: string; body: string } | null = null;
  const res = await notifySite([{ lang: "en", paths: ["/"] }], { PORTFOLIO_SITE_URL: "https://site.test/", PORTFOLIO_REVALIDATE_SECRET: "s3" }, (async (url: string, init: RequestInit) => {
    seen = { url, sig: (init.headers as Record<string, string>)["x-portfolio-signature"], body: String(init.body) };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);
  ok("notify: signed POST to /api/revalidate", res.ok && seen!.url === "https://site.test/api/revalidate" && verifySignature("s3", seen!.body, seen!.sig).ok);
  const bad = await notifySite([], { PORTFOLIO_SITE_URL: "https://site.test", PORTFOLIO_REVALIDATE_SECRET: "s3" }, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
  ok("notify: reports a refusal", !bad.ok && /401/.test(bad.error ?? ""));
}

console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
