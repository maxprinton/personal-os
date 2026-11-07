// Portfolio add-on, Phase 5: only finished public long videos can be shown, only whitelisted fields are copied,
// titles per language, short description, thumbnail copy, add / refresh / remove / order. Fake database, storage and network.
// Run: npm run test:portfolio-videos
import { fakeDb, type Row } from "./fake-supabase";
import { addVideo, copyThumbnail, eligibility, listVideos, loadSources, moveVideo, pickable, publicDescription, publicTitle, refreshVideos, removeVideo, setVideoFlag, snapshotOf, type VideoDeps, type VideoSource } from "@/lib/portfolio/videos";
import type { MediaStore } from "@/lib/portfolio/publish/media";
import { embedUrl, fmtLength, isoDuration, pickLatest, textOf, thumbOf, watchUrl, YT_ID as SITE_YT_ID } from "../portfolio/src/lib/videos";
import { buildNav } from "../portfolio/src/lib/nav";
import { SITE_DEFAULTS } from "../portfolio/src/lib/data";
import { DICT } from "../portfolio/src/lib/i18n";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const U = "u1";
const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, n, 0xff, 0xd9]);

function fakeStore() {
  const pub = new Map<string, Uint8Array>();
  const store: MediaStore & { pub: typeof pub } = {
    publicBase: "https://cdn.test/portfolio-media/",
    pub,
    download: async () => null,
    exists: async (p) => pub.has(p),
    upload: async (p, b) => (pub.set(p, b), true),
    list: async (f) => [...pub.keys()].filter((k) => k.startsWith(f + "/")),
    remove: async (ps) => void ps.forEach((p) => pub.delete(p)),
  };
  return store;
}
/** fake YouTube image server: maxres exists for some ids, hq for all */
function fakeFetch(opts: { noMax?: string[]; body?: (id: string) => Uint8Array; fail?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (opts.fail) throw new Error("offline");
    const m = /\/vi\/([^/]+)\/(maxresdefault|hqdefault)\.jpg$/.exec(u)!;
    if (m[2] === "maxresdefault" && opts.noMax?.includes(m[1])) return new Response("nope", { status: 404 });
    return new Response((opts.body ? opts.body(m[1]) : jpeg(m[1].charCodeAt(0))) as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

// ——— eligibility ———
const base: VideoSource = { id: "v1", idea_name: "My idea", kind: "long", stage: "published", youtube_video_id: "dQw4w9WgXcQ", published_at: "2026-10-01T10:00:00Z", fields: { title: "Main title", description: "Hello world", privacy: "public" } };
ok("eligible: finished public long video", eligibility(base).ok);
ok("not eligible: short", !eligibility({ ...base, kind: "short" }).ok);
ok("not eligible: not published yet", ["script", "edit", "publish", "bank", "archived"].every((stage) => !eligibility({ ...base, stage }).ok));
ok("not eligible: no / bad youtube id", !eligibility({ ...base, youtube_video_id: null }).ok && !eligibility({ ...base, youtube_video_id: "short" }).ok && !eligibility({ ...base, youtube_video_id: "a b c d e f g" }).ok && !eligibility({ ...base, youtube_video_id: "dQw4w9WgXcQ&x=1" }).ok);
ok("not eligible: private or unlisted", !eligibility({ ...base, fields: { privacy: "private" } }).ok && !eligibility({ ...base, fields: { privacy: "unlisted" } }).ok);
ok("eligible: privacy not recorded", eligibility({ ...base, fields: {} }).ok && eligibility({ ...base, fields: null }).ok);

// ——— titles and descriptions ———
{
  const v: VideoSource = { ...base, localizations: { es: { title: "Título", description: "Hola mundo" } }, pairTitle: "Pair title" };
  ok("title: localization first, then main title", publicTitle(v, "es") === "Título" && publicTitle(v, "en") === "Main title");
  ok("title: then primary pair, then idea name", publicTitle({ ...base, fields: {}, pairTitle: "Pair title" }, "en") === "Pair title" && publicTitle({ ...base, fields: {} }, "en") === "My idea" && publicTitle({ ...base, fields: {}, idea_name: "" }, "en") === "Untitled");
  ok("title: long titles are cut", publicTitle({ ...base, fields: { title: "x".repeat(300) } }, "en").length <= 150);
  ok("title: control characters removed", publicTitle({ ...base, fields: { title: "a\u0000b\n c" } }, "en") === "ab c");
  const desc = "Intro line.\nSecond line with https://evil.example/x?y=1 and www.site.com link.\n\n0:00 Intro\n1:23 Part two\nBuy my stuff https://aff.example";
  const d = publicDescription({ ...base, fields: { description: desc } }, "en");
  ok("description: stops at the chapter list, no links", d === "Intro line. Second line with and link." && !/http|www/.test(d), d);
  ok("description: capped at 400 on a word", publicDescription({ ...base, fields: { description: "word ".repeat(200) } }, "en").length <= 401 && publicDescription({ ...base, fields: { description: "word ".repeat(200) } }, "en").endsWith("…"));
  ok("description: empty is fine", publicDescription({ ...base, fields: {} }, "en") === "");
  ok("description: chapter list first → empty", publicDescription({ ...base, fields: { description: "0:00 Start\nmore" } }, "en") === "");
}

// ——— the snapshot has exactly the whitelisted fields ———
{
  const nasty = { ...base, script: "SECRET SCRIPT", strategy: "SECRET STRATEGY", ratings: { a: 1 }, tests: [1], note_id: "n1", quick_notes: "private", footage_folder: "C:\\x", predicted_views: 1 } as VideoSource;
  const s = snapshotOf(nasty);
  ok("snapshot: only the allowed keys", Object.keys(s).sort().join() === "description,published_at,title,youtube_video_id,yt_video_id", Object.keys(s).join());
  ok("snapshot: no private text anywhere", !JSON.stringify(s).match(/SECRET|private|footage|C:/));
}

// ——— thumbnail ———
{
  const st = fakeStore();
  const { f, calls } = fakeFetch();
  const url = await copyThumbnail(st, "dQw4w9WgXcQ", f);
  ok("thumb: copied under videos/<id>-<hash>.jpg and public url returned", !!url && /^https:\/\/cdn\.test\/portfolio-media\/videos\/dQw4w9WgXcQ-[0-9a-f]{16}\.jpg$/.test(url) && st.pub.size === 1, String(url));
  ok("thumb: asks only YouTube's image host, biggest first", calls[0] === "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" && calls.every((c) => c.startsWith("https://i.ytimg.com/vi/")));
  const again = await copyThumbnail(st, "dQw4w9WgXcQ", f);
  ok("thumb: same picture → same file, stored once", again === url && st.pub.size === 1);
  const f2 = fakeFetch({ body: () => jpeg(99) }).f;
  const changed = await copyThumbnail(st, "dQw4w9WgXcQ", f2);
  ok("thumb: new picture replaces the old file", changed !== url && st.pub.size === 1 && [...st.pub.keys()][0] === changed!.replace("https://cdn.test/portfolio-media/", ""));
  const hq = fakeFetch({ noMax: ["aaaaaaaaaaa"] });
  const st2 = fakeStore();
  ok("thumb: falls back to the smaller size", !!(await copyThumbnail(st2, "aaaaaaaaaaa", hq.f)) && hq.calls.length === 2);
  ok("thumb: network error → null, no throw", (await copyThumbnail(fakeStore(), "aaaaaaaaaaa", fakeFetch({ fail: true }).f)) === null);
  ok("thumb: not an image → null", (await copyThumbnail(fakeStore(), "aaaaaaaaaaa", fakeFetch({ body: () => new TextEncoder().encode("<html>hi</html>") }).f)) === null);
  const big = new Uint8Array(3 * 1024 * 1024);
  big.set([0xff, 0xd8, 0xff]);
  ok("thumb: too big → null", (await copyThumbnail(fakeStore(), "aaaaaaaaaaa", fakeFetch({ body: () => big }).f)) === null);
  const bad = fakeFetch();
  ok("thumb: bad id never reaches the network", (await copyThumbnail(fakeStore(), "../../etc/passwd", bad.f)) === null && bad.calls.length === 0);
}

// ——— database flow ———
function setup() {
  const tables: Record<string, Row[]> = {
    yt_videos: [
      { id: "v1", user_id: U, idea_name: "First", kind: "long", stage: "published", youtube_video_id: "aaaaaaaaaaa", published_at: "2026-09-01T00:00:00Z", script: "SECRET" },
      { id: "v2", user_id: U, idea_name: "Second", kind: "long", stage: "published", youtube_video_id: "bbbbbbbbbbb", published_at: "2026-10-01T00:00:00Z" },
      { id: "v3", user_id: U, idea_name: "A short", kind: "short", stage: "published", youtube_video_id: "ccccccccccc", published_at: "2026-10-02T00:00:00Z" },
      { id: "v4", user_id: U, idea_name: "Still editing", kind: "long", stage: "edit", youtube_video_id: null, published_at: null },
      { id: "v5", user_id: U, idea_name: "Private one", kind: "long", stage: "published", youtube_video_id: "eeeeeeeeeee", published_at: "2026-10-03T00:00:00Z" },
      { id: "v6", user_id: "other", idea_name: "Someone else", kind: "long", stage: "published", youtube_video_id: "fffffffffff", published_at: "2026-10-03T00:00:00Z" },
    ],
    yt_publish: [
      { video_id: "v1", user_id: U, fields: { title: "Primer video", description: "About it.\n0:00 Start", privacy: "public" }, localizations: { en: { title: "First video", description: "In English." } } },
      { video_id: "v5", user_id: U, fields: { title: "Hidden", privacy: "private" }, localizations: {} },
    ],
    yt_pairs: [{ video_id: "v2", user_id: U, is_primary: true, title_id: "t1" }],
    yt_variants: [{ id: "t1", user_id: U, value: "Pair based title" }],
    portfolio_videos: [],
  };
  const store = fakeStore();
  const net = fakeFetch();
  const d: VideoDeps = { sb: fakeDb(tables), userId: U, store, fetcher: net.f, durationOf: async (id) => (id === "aaaaaaaaaaa" ? 754 : null) };
  return { tables, store, d, net };
}

{
  const { tables, d } = setup();
  const src = await loadSources(d.sb, U);
  ok("sources: only this user's finished long videos", src.map((s) => s.id).sort().join() === "v1,v2,v5", src.map((s) => s.id).join());
  const picks = await pickable(d.sb, U);
  ok("picker: private video is listed with a reason, short / unfinished / other users' are absent", picks.length === 3 && picks.find((p) => p.id === "v5")?.reason !== undefined && !picks.some((p) => ["v3", "v4", "v6"].includes(p.id)));

  ok("add: a short is refused", !(await addVideo(d, "v3")).ok);
  ok("add: unfinished is refused", !(await addVideo(d, "v4")).ok);
  ok("add: private is refused", !(await addVideo(d, "v5")).ok);
  ok("add: another user's video is refused", !(await addVideo(d, "v6")).ok);
  ok("add: unknown id is refused", !(await addVideo(d, "nope")).ok);
  ok("add: nothing was written by the refusals", tables.portfolio_videos.length === 0);

  const a = await addVideo(d, "v1");
  ok("add: ok", a.ok, JSON.stringify(a));
  const row = tables.portfolio_videos[0];
  ok("add: row has the snapshot", row.youtube_video_id === "aaaaaaaaaaa" && (row.title as Record<string, string>).en === "First video" && (row.title as Record<string, string>).es === "Primer video" && row.yt_video_id === "v1" && row.duration_s === 754 && row.is_live === true && row.featured === false && row.position === 1);
  ok("add: description is short and clean", (row.description as Record<string, string>).en === "In English." && (row.description as Record<string, string>).es === "About it.");
  ok("add: thumbnail is our own copy", String(row.thumb_url).startsWith("https://cdn.test/portfolio-media/videos/aaaaaaaaaaa-"));
  ok("add: no private field reached the public row", !JSON.stringify(row).includes("SECRET") && Object.keys(row).every((k) => ["id", "created_at", "updated_at", "user_id", "yt_video_id", "youtube_video_id", "title", "description", "thumb_url", "duration_s", "published_at", "featured", "position", "is_live"].includes(k)), Object.keys(row).join());
  ok("add: twice is refused", !(await addVideo(d, "v1")).ok && tables.portfolio_videos.length === 1);

  const b = await addVideo(d, "v2");
  ok("add: pair title used, position after the first", b.ok && (tables.portfolio_videos[1].title as Record<string, string>).en === "Pair based title" && tables.portfolio_videos[1].position === 2 && tables.portfolio_videos[1].duration_s === null);
  const left = await pickable(d.sb, U);
  ok("picker: added videos disappear from it", left.length === 1 && left[0].id === "v5");

  // order
  const id1 = tables.portfolio_videos[0].id as string;
  const id2 = tables.portfolio_videos[1].id as string;
  await moveVideo(d, id2, "up");
  ok("move: swaps neighbours", (await listVideos(d.sb, U)).map((r) => r.id).join() === `${id2},${id1}`);
  await moveVideo(d, id2, "up");
  ok("move: first stays first", (await listVideos(d.sb, U))[0].id === id2);
  ok("move: unknown id fails", !(await moveVideo(d, "zzz", "up")).ok);

  // flags
  await setVideoFlag(d, id1, "featured", true);
  await setVideoFlag(d, id1, "is_live", false);
  ok("flags: featured and hidden", tables.portfolio_videos.find((r) => r.id === id1)!.featured === true && tables.portfolio_videos.find((r) => r.id === id1)!.is_live === false);

  // refresh picks up source changes, keeps rows whose source is gone
  (tables.yt_publish[0].localizations as Record<string, { title: string }>).en.title = "First video (new)";
  const r1 = await refreshVideos(d, id1);
  ok("refresh: new title copied", r1.ok && (tables.portfolio_videos.find((r) => r.id === id1)!.title as Record<string, string>).en === "First video (new)");
  ok("refresh: keeps the flags the owner chose", tables.portfolio_videos.find((r) => r.id === id1)!.featured === true && tables.portfolio_videos.find((r) => r.id === id1)!.is_live === false);
  tables.yt_videos[0].stage = "archived";
  const r2 = await refreshVideos(d);
  ok("refresh all: a video that is no longer finished is skipped, not deleted", r2.ok && (r2 as { skipped: number }).skipped === 1 && (r2 as { updated: number }).updated === 1 && tables.portfolio_videos.length === 2);
  tables.yt_videos.splice(0, 1);
  tables.portfolio_videos.find((r) => r.id === id1)!.yt_video_id = null; // what "on delete set null" does
  const r3 = await refreshVideos(d, id1);
  ok("refresh: source deleted → copy stays as it was", r3.ok && (r3 as { skipped: number }).skipped === 1 && (tables.portfolio_videos.find((r) => r.id === id1)!.title as Record<string, string>).en === "First video (new)");
  ok("refresh: unknown id fails", !(await refreshVideos(d, "zzz")).ok);

  // remove
  const filesBefore = d.store.list("videos");
  ok("remove: thumbnail file exists before", (await filesBefore).some((p) => p.includes("aaaaaaaaaaa")));
  const rm = await removeVideo(d, id1);
  ok("remove: row and its thumbnail file are gone, the other video stays", rm.ok && tables.portfolio_videos.length === 1 && !(await d.store.list("videos")).some((p) => p.includes("aaaaaaaaaaa")) && (await d.store.list("videos")).some((p) => p.includes("bbbbbbbbbbb")));
  ok("remove: unknown id fails", !(await removeVideo(d, "zzz")).ok);
}

// ——— public site helpers ———
{
  ok("site: embed only for a valid id, on the privacy-enhanced domain", embedUrl("dQw4w9WgXcQ") === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0" && embedUrl("x\"><script>") === null && embedUrl("") === null && watchUrl("bad") === null);
  ok("site: id pattern matches the OS one", ["dQw4w9WgXcQ", "a-b_c-d_e-f", "short", "toolongtoolong1", "a b c d e f g", "javascript:1"].every((x) => SITE_YT_ID.test(x) === /^[A-Za-z0-9_-]{11}$/.test(x)));
  ok("site: length formatting", fmtLength(754) === "12:34" && fmtLength(3723) === "1:02:03" && fmtLength(59) === "0:59" && fmtLength(null) === "" && fmtLength(0) === "");
  ok("site: ISO duration for search engines", isoDuration(754) === "PT12M34S" && isoDuration(3600) === "PT1H" && isoDuration(3723) === "PT1H2M3S" && isoDuration(45) === "PT45S" && isoDuration(null) === undefined);
  ok("site: text falls back to the other language", textOf({ en: "Hi" }, "es") === "Hi" && textOf({ es: "Hola", en: "Hi" }, "es") === "Hola" && textOf({ es: "  " , en: "Hi" }, "es") === "Hi" && textOf(null, "en") === "");
  ok("site: thumbnail must be https", thumbOf({ thumb_url: "https://cdn.test/x.jpg" }) === "https://cdn.test/x.jpg" && thumbOf({ thumb_url: "javascript:alert(1)" }) === null && thumbOf({ thumb_url: "http://x/y.jpg" }) === null && thumbOf({ thumb_url: null }) === null);
  const v = (id: string, featured: boolean, position: number, published_at: string | null) => ({ id, featured, position, published_at });
  ok("latest: first featured in the owner's order", pickLatest([v("a", false, 1, "2026-10-01T00:00:00Z"), v("b", true, 3, "2026-01-01T00:00:00Z"), v("c", true, 2, "2025-01-01T00:00:00Z")])?.id === "c");
  ok("latest: none featured → newest", pickLatest([v("a", false, 1, "2026-01-01T00:00:00Z"), v("b", false, 2, "2026-10-01T00:00:00Z"), v("c", false, 3, null)])?.id === "b");
  ok("latest: empty → null", pickLatest([]) === null);
  ok("menu: Videos shows only when there are videos", buildNav("en", SITE_DEFAULTS, [], { videos: true }).some((n) => n.key === "videos") && !buildNav("en", SITE_DEFAULTS, [], { videos: false }).some((n) => n.key === "videos") && !buildNav("en", SITE_DEFAULTS, []).some((n) => n.key === "videos"));
  ok("menu: spanish label and address", buildNav("es", SITE_DEFAULTS, [], { videos: true }).find((n) => n.key === "videos")?.href === "/es/videos");
  ok("i18n: video texts in both languages", ["intro", "latest", "all", "none", "watch"].every((k) => !!(DICT.en.videos as Record<string, unknown>)[k] && !!(DICT.es.videos as Record<string, unknown>)[k]) && DICT.es.videos.play("X").includes("X"));
}

// ——— the OS never reads private YouTube tables beyond the whitelist ———
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/portfolio/videos.ts", import.meta.url), "utf8");
  const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  ok("source: reads only the four allowed tables", [...new Set(tables)].sort().join() === "portfolio_videos,yt_pairs,yt_publish,yt_variants,yt_videos", [...new Set(tables)].join());
  ok("source: never reads scripts, shots, tests or strategy", !/yt_(sections|shots|tests|cues|moments|clips|edit|cuts|review|music|postmortems|weekly|cards|buckets|references)/.test(src));
  ok("source: yt_videos is read with a fixed column list", /from\("yt_videos"\)\.select\("id,idea_name,kind,stage,youtube_video_id,published_at"\)/.test(src) && !/select\("\*"\)/.test(src));
}

console.log(`${fail ? "❌" : "✅"} portfolio videos: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
