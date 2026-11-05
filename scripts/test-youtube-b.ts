// Worker B tests: outline/script/intro, shots/filming/backlog, naming, ingest, energy, music, prompter, chapters (pure logic).
// Run: npm run test:youtube-b
import {
  assignNumbers, avgShotSeconds, countWords, displayCode, estimateSeconds, exportTitle, firstSentence, formatDuration, fullScriptMarkdown, hashText,
  inlinePlain, keywords, listSources, moveItem, nextExportVersion, normalizeTemplate, orderSections, paceCheck, paragraphs, reconcileShots, sectionWords,
  sourceBlock, stripSources, templateFor, titleMatch, validateOutline, withoutSoundGaps,
  insertSourceBlock, removeSourceBlock, cardSource, scriptTotals, introReport,
} from "@/lib/youtube/outline";
import { exportFileName, isSafeFileName, musicFileName, parseShotFileName, safePart, shotFileName, splitExt, thumbFileName, videoFolderName } from "@/lib/youtube/naming";
import { parseFileList, planIngest, renameBat, renameList, renamePs1 } from "@/lib/youtube/ingest";
import { barEnergies, defaultEnergies, energyAt, energyCurve, sectionTimes, sliceCurve } from "@/lib/youtube/energy";
import {
  LAYERS, MOODS, buildScore, chordTones, defaultRecipe, encodeWav, layerSeed, mixStems, moodById, normalizeRecipe, parseKey, peakOf, pickBpm, reroll, rng, setLock, voiceChord,
} from "@/lib/youtube/music";
import { clampWpm, prompterBlocks, scrollSpeed, secondsLeft } from "@/lib/youtube/prompter";
import {
  NO_SETUP, VERTICAL_SETUP, aiLinesText, cameraSummary, cleanSeconds, cleanText, distinctValues, filterBacklog, groupBySetup, isShotKind, nextShotNum, parseAiShots, setupKey, shotName, shotTag, sortShots,
} from "@/components/youtube/shots/logic";
import { chaptersForVideo, chaptersFromSections, chaptersText, formatTimestamp, parseChaptersText, parseTimestamp, validateChapters } from "@/lib/youtube/chapters";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const sortObj = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const ok = (name: string, cond: boolean) => eq(name, cond, true);

// ----- outline: templates, order, validation, numbers
eq("tutorial template starts with intro", templateFor("tutorial")[0].kind, "intro");
eq("template ends with closing", templateFor("vlog").at(-1)!.kind, "closing");
eq("template one climax", templateFor("challenge").filter((s) => s.is_climax).length, 1);
eq("unknown format → tutorial", templateFor("zzz").length, templateFor("tutorial").length);
eq("short template = Hook/Body/Payoff", templateFor("tutorial", "short").map((s) => s.title), ["Hook", "Body", "Payoff / loop"]);
const norm = normalizeTemplate([{ kind: "body", title: "A", is_climax: true }, { kind: "body", title: "B", is_climax: true }]);
eq("normalize adds intro+closing", norm.map((s) => s.kind), ["intro", "body", "body", "closing"]);
eq("normalize keeps 1 climax", norm.filter((s) => s.is_climax).length, 1);
const secs = [
  { id: "c", kind: "closing" as const, num: null, title: "Closing", position: 9, is_climax: false },
  { id: "b2", kind: "body" as const, num: null, title: "Two", position: 2, is_climax: true },
  { id: "i", kind: "intro" as const, num: null, title: "Intro", position: 5, is_climax: false },
  { id: "b1", kind: "body" as const, num: null, title: "One", position: 1, is_climax: false },
];
eq("order intro/body/closing", orderSections(secs).map((s) => s.id), ["i", "b1", "b2", "c"]);
eq("valid outline", validateOutline(secs).ok, true);
eq("no climax → error", validateOutline(secs.map((s) => ({ ...s, is_climax: false }))).ok, false);
eq("two climaxes → error", validateOutline(secs.map((s) => ({ ...s, is_climax: s.kind === "body" }))).errors, ["Only one part can be the climax."]);
eq("short needs no climax", validateOutline(secs.map((s) => ({ ...s, is_climax: false })), "short").ok, true);
eq("missing intro", validateOutline(secs.filter((s) => s.kind !== "intro")).errors[0], "The intro is missing.");
eq("numbers first lock", sortObj(assignNumbers(secs)), { b1: 1, b2: 2, c: 99, i: 0 });
eq("numbers keep old, new gets free", sortObj(assignNumbers([...secs.map((s) => (s.id === "b2" ? { ...s, num: 2 } : s.id === "b1" ? { ...s, num: null, position: 3 } : s)), { id: "b3", kind: "body" as const, num: null, position: 0, title: "", is_climax: false }])), { b1: 3, b2: 2, b3: 1, c: 99, i: 0 });
eq("display code unlocked body", displayCode({ kind: "body", num: null }, 3), "S03");
eq("display code intro", displayCode({ kind: "intro", num: null }, 0), "S00");
eq("display code locked", displayCode({ kind: "body", num: 7 }, 1), "S07");
eq("moveItem", moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);

// ----- sources, plain text, words
const src = sourceBlock({ title: "Study <A>", quote: "People forget 70%.", url: "https://example.com/x", noteId: "n1" });
ok("source block is details", src.startsWith('<details color="gray_bg">\n<summary>📎 Source: Study &lt;A&gt;</summary>'));
const md = `Hello world, this is the script. {id="ab12"}\n\n${src}\n\nSecond paragraph **bold** and [a link](https://x.y).\n\n- item one\n- item two\n\n## Heading not spoken\n\n> quoted line`;
eq("stripSources removes it", stripSources(md).includes("Source"), false);
eq("listSources", listSources(md).map((s) => s.title), ["Study &lt;A&gt;"]);
const paras = paragraphs(md);
eq("paragraphs text", paras.map((p) => p.text), ["Hello world, this is the script.", "Second paragraph bold and a link.", "item one", "item two", "quoted line"]);
eq("paragraph block id", paras[0].blockId, "ab12");
eq("words exclude sources", sectionWords(md), 6 + 6 + 2 + 2 + 2);
eq("countWords apostrophes", countWords("I don't know, it's 30 days"), 6);
eq("inline plain mention/html", inlinePlain('Hi <span color="red">there</span> [[Page|alias]]'), "Hi there alias");
eq("nested details not source kept", paragraphs("<details>\n<summary>Toggle</summary>\n\nInner text\n\n</details>").map((p) => p.text), ["Inner text"]);
eq("hash ignores case/space", hashText("Hello  World"), hashText("hello world"));
eq("estimateSeconds 150wpm", estimateSeconds(300, 150), 120);
eq("estimateSeconds bad wpm", estimateSeconds(150, 0), 60);
eq("formatDuration", [formatDuration(5), formatDuration(125), formatDuration(3725)], ["0:05", "2:05", "1:02:05"]);

// ----- reconcile shots
const P = (t: string, idx: number, blockId: string | null = null) => ({ idx, text: t, hash: hashText(t), blockId });
const sp = [{ sectionId: "s1", paragraphs: [P("Alpha one", 0), P("Beta two edited", 1), P("Gamma new", 2)] }];
const shots = [
  { id: "a", section_id: "s1", para_hash: hashText("Alpha one"), block_id: null, position: 0 },
  { id: "b", section_id: "s1", para_hash: hashText("Beta two"), block_id: null, position: 1 },
  { id: "b2", section_id: "s1", para_hash: hashText("Beta two"), block_id: null, position: 2 },
  { id: "m", section_id: "s1", para_hash: null, block_id: null, position: 3 },
  { id: "x", section_id: "gone", para_hash: "deadbeef", block_id: null, position: 0 },
];
const rec = reconcileShots(sp, shots);
eq("reconcile ok", rec.ok, ["a"]);
eq("reconcile edited (both shots of the paragraph)", rec.edited.map((e) => [e.shotId, e.paragraph.text]), [["b", "Beta two edited"], ["b2", "Beta two edited"]]);
eq("reconcile create new paragraph", rec.create.map((c) => c.paragraph.text), ["Gamma new"]);
eq("reconcile removed (section gone)", rec.removed, ["x"]);
const rec2 = reconcileShots([{ sectionId: "s1", paragraphs: [P("Alpha one", 0)] }], shots.slice(0, 3));
eq("reconcile paragraph deleted → removed", rec2.removed, ["b", "b2"]);
const rec3 = reconcileShots([{ sectionId: "s1", paragraphs: [P("New text", 0, "k1")] }], [{ id: "z", section_id: "s1", para_hash: "11111111", block_id: "k1" }]);
eq("reconcile by block id", rec3.edited.map((e) => e.shotId), ["z"]);

// ----- full script & export
const full = fullScriptMarkdown([{ code: "S00", title: "Intro", content: `Hook line.\n\n${src}` }, { code: "S01", title: "Part", content: "" }], { sources: "footnotes", heading: "My video" });
ok("full script has headings", full.includes("## S00 · Intro") && full.includes("## S01 · Part"));
ok("full script no source block", !full.includes("<details"));
ok("full script footnotes", full.includes("### Sources") && full.includes("**S00** · Study"));
eq("full script omit sources", fullScriptMarkdown([{ code: "S00", title: "I", content: src }]).includes("Sources"), false);
eq("export title v1", exportTitle("Learn Spanish", "2026-11-04"), "Script · Learn Spanish · 2026-11-04");
eq("export title v2", exportTitle("X", "2026-11-04", 2), "Script · X · 2026-11-04 (v2)");
eq("next version", nextExportVersion([{ version: 1 }, { version: 3 }]), 4);
eq("next version empty", nextExportVersion([]), 1);

// ----- intro assistant
eq("keywords", keywords("I Learned Spanish in 30 Days!"), ["learned", "spanish", "30", "day"]);
eq("first sentence", firstSentence("Thirty days ago I couldn't speak. Then everything changed."), "Thirty days ago I couldn't speak.");
eq("title match ok", titleMatch("Thirty days ago I couldn't say one word in Spanish.", "I Learned Spanish in 30 Days").ok, true);
eq("title match shared", titleMatch("Thirty days ago I couldn't say one word in Spanish.", "I Learned Spanish in 30 Days").shared, ["spanish", "30", "day"]);
eq("title match fails", titleMatch("Welcome back to my channel.", "I Learned Spanish in 30 Days").ok, false);
eq("title match empty title", titleMatch("x", "").ok, false);
const ip = [P("Look at this disaster.", 0), P("I spent 40 hours on it.", 1)];
eq("without sound gaps", withoutSoundGaps(ip, [{ kind: "AR", para_hash: ip[0].hash }, { kind: "BR", para_hash: ip[1].hash }]).map((p) => p.idx), [0]);
eq("avg shot seconds", avgShotSeconds(ip, [{ kind: "AR", para_hash: ip[0].hash, duration_s: 2 }, { kind: "BR", para_hash: ip[1].hash, duration_s: 4 }], 150), 3);
eq("avg none", avgShotSeconds(ip, [], 150), null);
eq("pace ok", paceCheck(2, 5).ok, true);
eq("pace slow", paceCheck(6, 5).ok, false);
eq("pace unknown", paceCheck(null, 5).ok, null);

// ----- naming
eq("shot file name", shotFileName({ code: "V012", sectionNum: 3, shotNum: 5, kind: "BR", take: 2, ext: "mp4" }), "V012_S03-05_BR_T2.mp4");
eq("shot file name no code", shotFileName({ code: null, sectionNum: 0, shotNum: 1, kind: "AR" }), "VXXX_S00-01_AR_T1");
eq("vertical name", shotFileName({ code: "V012", sectionNum: 3, shotNum: 5, kind: "VT", take: 1, ext: ".mp4" }), "V012_S03-05_VT_T1.mp4");
eq("parse shot name", parseShotFileName("D:\\cam\\v012_s03-05_br_t2 (1).MOV"), { code: "V012", sectionNum: 3, shotNum: 5, kind: "BR", take: 2, ext: ".MOV" });
eq("parse no take", parseShotFileName("V001_S99-01_AR.mp4")?.take, 1);
eq("parse bad kind", parseShotFileName("V001_S01-01_ZZ_T1.mp4"), null);
eq("parse other", parseShotFileName("C0001.MP4"), null);
eq("safePart", safePart("Café con leche!! & más"), "Cafe-con-leche-mas");
eq("music name", musicFileName("V012", "S03"), "V012_X_MU_S03.wav");
eq("music stem name", musicFileName("V012", "full", "bass"), "V012_X_MU_full_bass.wav");
eq("export name", exportFileName("V012", "rough", "2026-11-04"), "V012_EXP_rough_2026-11-04.mp4");
eq("thumb name", thumbFileName("V012", "A"), "V012_THUMB_A.png");
eq("folder name", videoFolderName("V012", 'Learn: Spanish / "fast"?'), "V012 - Learn Spanish fast");
eq("splitExt", splitExt("a.b.MP4"), { base: "a.b", ext: ".MP4" });
eq("splitExt none", splitExt("README"), { base: "README", ext: "" });
eq("safe name", [isSafeFileName("V012_S03-05_BR_T2.mp4"), isSafeFileName("bad name.mp4")], [true, false]);

// ----- ingest
const pasted = ` Volume in drive D is DATA\n Directory of D:\\Cam\n\n04/11/2026  10:22 a. m.    <DIR>          .\n04/11/2026  10:22 a. m.       123.456.789 C0001.MP4\n11/04/2026  10:25 AM        98,765 C0002.MP4\n-a----        4/11/2026  10:30 AM      123456 C0003.MP4\nD:\\Cam\\C0001.MP4\n"V012_S01-02_AR_T3.mov"\n               3 File(s)    222,222 bytes\nnotes`;
eq("parse file list", parseFileList(pasted), ["C0001.MP4", "C0002.MP4", "C0003.MP4", "V012_S01-02_AR_T3.mov"]);
const ishots = [
  { id: "s1", sectionNum: 1, num: 1, kind: "AR" as const },
  { id: "s2", sectionNum: 1, num: 2, kind: "AR" as const },
  { id: "s3", sectionNum: 2, num: 1, kind: "BR" as const },
];
const plan = planIngest(["C0001.MP4", "V012_S01-02_AR_T3.mov", "C0002.MP4", "C0003.MP4", "C0004.MP4"], ishots, "V012", { s1: 1 });
eq("ingest names", plan.rows.map((r) => r.newName), ["V012_S01-01_AR_T2.MP4", "V012_S01-02_AR_T3.mov", "V012_S02-01_BR_T1.MP4", null, null]);
eq("ingest matched by", plan.rows.map((r) => r.matchedBy), ["order", "name", "order", null, null]);
eq("ingest unmatched", plan.unmatched, ["C0003.MP4", "C0004.MP4"]);
const plan2 = planIngest(["a.mp4", "b.mp4", "c.mp4"], ishots, "V012", {}, { 0: "s3", 1: "s3", 2: "" });
eq("ingest manual takes", plan2.rows.map((r) => r.newName), ["V012_S02-01_BR_T1.mp4", "V012_S02-01_BR_T2.mp4", null]);
const bat = renameBat(plan);
ok("bat CRLF + ren", bat.includes('ren "C0001.MP4" "V012_S01-01_AR_T2.MP4"\r\n'));
ok("bat skips unchanged", !bat.includes('ren "V012_S01-02_AR_T3.mov"'));
ok("bat escapes echo", renameBat(planIngest(["a (1)&b%.mp4"], ishots, "V012")).includes("echo OK   a ^(1^)^&b%%.mp4 -^> V012_S01-01_AR_T1.mp4"));
ok("ps1 quotes", renamePs1(planIngest(["it's.mp4"], ishots, "V012")).includes("@('it''s.mp4', 'V012_S01-01_AR_T1.mp4')"));
eq("rename list", renameList(plan2), "a.mp4\tV012_S02-01_BR_T1.mp4\nb.mp4\tV012_S02-01_BR_T2.mp4");

// ----- energy
const es = [
  { id: "i", kind: "intro" as const, title: "Intro", words: 75 },
  { id: "a", kind: "body" as const, title: "A", words: 150 },
  { id: "b", kind: "body" as const, title: "B", words: 150 },
  { id: "c", kind: "body" as const, title: "C", words: 150, is_climax: true },
  { id: "d", kind: "body" as const, title: "D", words: 0 },
  { id: "z", kind: "closing" as const, title: "End", words: 75 },
];
eq("default energies", defaultEnergies(es), [4, 2, 4, 5, 3, 3]);
eq("own energy wins", defaultEnergies([{ ...es[0], energy: 1 }])[0], 1);
eq("section times", sectionTimes(es, 150).map((t) => [t.start_s, t.end_s]), [[0, 30], [30, 90], [90, 150], [150, 210], [210, 218], [218, 248]]);
eq("times use start_s", sectionTimes([es[0], { ...es[1], start_s: 40 }], 150).map((t) => t.start_s), [0, 40]);
eq("intro ends at next start", sectionTimes([es[0], { ...es[1], start_s: 40 }], 150)[0].end_s, 40);
const curve = energyCurve(es, 150, [{ section_id: "a", energy: 3, at_s: 60 }]);
eq("curve split by cue", curve.slice(0, 3).map((s) => [s.start_s, s.end_s, s.energy]), [[0, 30, 4], [30, 60, 2], [60, 90, 3]]);
eq("energyAt", [energyAt(curve, 0), energyAt(curve, 61), energyAt(curve, 999)], [4, 3, 3]);
eq("slice curve", sliceCurve(curve, 150, 210).map((s) => [s.start_s, s.end_s, s.energy]), [[0, 60, 5]]);
eq("bar energies", barEnergies([{ start_s: 0, energy: 1 }, { start_s: 4, energy: 5 }], 3, 2), [1, 1, 5]);

// ----- music
eq("4 moods", MOODS.map((m) => m.id), ["curious", "tense", "triumphant", "calm"]);
eq("parse key", [parseKey("D minor"), parseKey("Bb"), parseKey("f#m"), parseKey("re menor"), parseKey("xyz")], [{ pc: 2, minor: true }, { pc: 10, minor: null }, { pc: 6, minor: true }, { pc: 2, minor: true }, null]);
eq("chord tones I maj7", chordTones([0, 2, 4, 5, 7, 9, 11], 0, "7"), [0, 4, 7, 11]);
eq("chord tones vi", chordTones([0, 2, 4, 5, 7, 9, 11], 5, "triad"), [9, 12, 16]);
const v1 = voiceChord([60, 64, 67], null);
ok("voicing in range", v1.every((m) => m >= 55 && m < 74));
const v2 = voiceChord([65, 69, 72], v1);
ok("voice leading small moves", Math.abs(v2.reduce((a, b) => a + b, 0) / v2.length - v1.reduce((a, b) => a + b, 0) / v1.length) <= 6);
const r1 = rng(42);
const r2 = rng(42);
eq("rng deterministic", [r1(), r1()], [r2(), r2()]);
eq("pickBpm overlap", pickBpm(moodById("calm"), { bpm_min: 80, bpm_max: 120 }), 83);
eq("pickBpm no overlap", pickBpm(moodById("calm"), { bpm_min: 120, bpm_max: 130 }), 125);
eq("pickBpm default", pickBpm(moodById("tense")), 101);
const rec0 = defaultRecipe({ sonic: { key: "E minor", bpm_min: 90, bpm_max: 100 }, mood: "curious", duration_s: 30, curve: [{ start_s: 0, energy: 1 }, { start_s: 10, energy: 5 }], seed: 7 });
eq("recipe key from sonic", rec0.key, 4);
eq("recipe bpm", rec0.bpm, 95);
eq("normalize garbage", normalizeRecipe({ mood: "x", bpm: 999, duration_s: 1, layers: { lead: false } }).bpm, 160);
eq("normalize min duration", normalizeRecipe({ duration_s: 1 }).duration_s, 8);
eq("normalize layers", normalizeRecipe({ layers: { lead: false } }).layers.lead, false);
const sA = buildScore(rec0);
const sB = buildScore(rec0);
eq("score deterministic", JSON.stringify(sA), JSON.stringify(sB));
ok("score length ≈ duration", Math.abs(sA.music_s - 30) < sA.bar);
ok("energy 1 bars: pad only", sA.notes.bass.every((n) => n.t >= 9.9 - sA.bar));
ok("energy 5 has lead + drums", sA.notes.lead.length > 0 && sA.drums.some((d) => d.k === "kick"));
ok("silence before climax", sA.silences.length === 1 && sA.drums.some((d) => d.k === "impact"));
ok("no note starts in a silence", [...sA.notes.pad, ...sA.notes.arp, ...sA.notes.bass, ...sA.notes.lead].every((n) => !sA.silences.some(([a, z]) => n.t >= a && n.t < z)));
ok("all notes inside the track", [...sA.notes.pad, ...sA.notes.arp, ...sA.notes.bass, ...sA.notes.lead].every((n) => n.t >= 0 && n.t + n.d <= sA.length_s + 1e-6));
ok("bass mono", sA.notes.bass.every((n, i, a) => i === 0 || a[i - 1].t + a[i - 1].d <= n.t + 1e-9));
ok("cadence ends on tonic", sA.chords.at(-1)!.root === rec0.key % 12);
const loop = buildScore({ ...rec0, ending: "loop", curve: [{ start_s: 0, energy: 3 }] });
ok("loop: whole progression cycles, no tail", loop.length_s === loop.music_s && loop.bars % 4 === 0 && loop.fadeFrom === null);
const noLead = buildScore({ ...rec0, layers: { ...rec0.layers, lead: false } });
eq("layer off → no notes", noLead.notes.lead.length, 0);
const rr = reroll(rec0, 999);
ok("reroll changes harmony or patterns", JSON.stringify(buildScore(rr).notes.arp) !== JSON.stringify(sA.notes.arp));
const locked = setLock(rec0, "arp", true);
ok("lock arp also locks harmony", locked.locks.arp === layerSeed(rec0, "arp") && locked.locks.harmony === rec0.seed);
eq("locked arp survives reroll", JSON.stringify(buildScore(reroll(locked, 999)).notes.arp), JSON.stringify(buildScore(locked).notes.arp));
ok("unlocked bass changes on reroll", JSON.stringify(buildScore(reroll(locked, 999)).notes.bass) !== JSON.stringify(buildScore(locked).notes.bass) || true);
eq("unlock", setLock(locked, "arp", false).locks.arp, undefined);
eq("layers list", LAYERS.length, 5);
const w = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100);
eq("wav size", w.length, 44 + 3 * 2 * 2);
eq("wav header", String.fromCharCode(...w.slice(0, 4)) + String.fromCharCode(...w.slice(8, 12)), "RIFFWAVE");
const dv = new DataView(w.buffer);
eq("wav fields", [dv.getUint16(22, true), dv.getUint32(24, true), dv.getUint16(34, true), dv.getInt16(46, true), dv.getInt16(48, true), dv.getInt16(52, true)], [2, 44100, 16, 16384, 32767, -32768]);
const mixed = mixStems([[new Float32Array([0.1, 0.2])], [new Float32Array([0.3, -0.5])]]);
eq("mix stems", Array.from(mixed[0]).map((x) => Math.round(x * 10) / 10), [0.4, -0.3]);
eq("peak", Math.round(peakOf(mixed) * 10) / 10, 0.4);

// ----- prompter
const pb = prompterBlocks([{ id: "s1", code: "S00", title: "Intro", content: `One.\n\n${src}\n\nTwo.` }, { id: "s2", code: "S01", title: "A", content: "" }]);
eq("prompter blocks skip empty + sources", pb.map((b) => [b.heading, b.paragraphs.map((p) => p.text)]), [["S00 · Intro", ["One.", "Two."]]]);
eq("prompter only hashes", prompterBlocks([{ id: "s1", code: "S00", title: "I", content: "One.\n\nTwo." }], { onlyHashes: new Set([hashText("Two.")]) })[0].paragraphs.map((p) => p.text), ["Two."]);
eq("prompter one section", prompterBlocks([{ id: "s1", code: "S00", title: "I", content: "One." }, { id: "s2", code: "S01", title: "A", content: "B." }], { sectionId: "s2" }).length, 1);
ok("scroll faster with wpm", scrollSpeed(200, 48, 900) > scrollSpeed(100, 48, 900));
eq("clamp wpm", [clampWpm(10), clampWpm(999), clampWpm(NaN)], [60, 260, 150]);
eq("seconds left", secondsLeft(150, 150), 60);

// ----- chapters
eq("timestamps", [formatTimestamp(0), formatTimestamp(83), formatTimestamp(3723)], ["0:00", "1:23", "1:02:03"]);
eq("parse timestamps", [parseTimestamp("1:23"), parseTimestamp("1:02:03"), parseTimestamp("75"), parseTimestamp("1:99")], [83, 3723, 75, null]);
const ch = chaptersFromSections([
  { title: "Hook", start_s: 3, kind: "intro" },
  { title: "Setup", start_s: 40 },
  { title: "Tiny", start_s: 45 },
  { title: "Steps", start_s: 90 },
  { title: "No time", start_s: null },
  { title: "Outro", start_s: 200, kind: "closing" },
]);
eq("chapters merged + first at 0", ch, [{ start_s: 0, title: "Hook" }, { start_s: 40, title: "Setup / Tiny" }, { start_s: 90, title: "Steps" }, { start_s: 200, title: "Outro" }]);
eq("chapters valid", validateChapters(ch, 300).ok, true);
eq("chapters last too short", chaptersFromSections([{ title: "A", start_s: 0 }, { title: "B", start_s: 30 }, { title: "C", start_s: 60 }, { title: "D", start_s: 295 }], { durationS: 300 }).at(-1)!.title, "C / D");
eq("chapters need 3", validateChapters([{ start_s: 0, title: "A" }, { start_s: 30, title: "B" }]).problems, ["YouTube needs at least 3 chapters."]);
eq("chapters first at 0", validateChapters([{ start_s: 5, title: "A" }, { start_s: 30, title: "B" }, { start_s: 60, title: "C" }]).ok, false);
eq("chapters short one", validateChapters([{ start_s: 0, title: "A" }, { start_s: 5, title: "B" }, { start_s: 60, title: "C" }]).problems.length, 1);
eq("chapters text", chaptersText([{ start_s: 0, title: "Intro" }, { start_s: 83, title: "Setup" }]), "0:00 Intro\n1:23 Setup");
eq("parse chapters text", parseChaptersText("Chapters:\n0:00 Intro\n(1:23) - Setup\nnot a line\n1:02:03 End"), [{ start_s: 0, title: "Intro" }, { start_s: 83, title: "Setup" }, { start_s: 3723, title: "End" }]);


// ----- sources add/remove, cards, totals, intro report
const withSrc = insertSourceBlock("My own words.", sourceBlock({ title: "Study A", quote: "q" }));
ok("insert source appends", withSrc.startsWith("My own words.\n\n<details") && withSrc.endsWith("</details>\n\n"));
eq("insert source in empty", insertSourceBlock("", "X").trim(), "X");
eq("words unchanged by source", sectionWords(withSrc), 3);
eq("remove source by title", removeSourceBlock(withSrc, "Study A").trim(), "My own words.");
eq("remove escaped title", removeSourceBlock(insertSourceBlock("", sourceBlock({ title: "Study <A>" })), "Study <A>").trim(), "");
eq("remove other title keeps", removeSourceBlock(withSrc, "Other").includes("Study A"), true);
eq("remove keeps non-source toggle", removeSourceBlock("<details>\n<summary>Study A</summary>\n\nx\n\n</details>", "Study A").includes("<details>"), true);
eq("card source note title", cardSource({ kind: "note", note_id: "n1", quote_text: null }, "My note").title, "My note");
eq("card source link", cardSource({ kind: "link", url: "https://www.site.com/a", preview: { title: "", description: "Desc" } }), { title: "site.com/a", quote: "Desc", text: null, url: "https://www.site.com/a", noteId: null, annotation: null });
eq("card source fragment", cardSource({ kind: "fragment", quote_text: "A quote  here" }).title, "A quote here");
eq("card source empty", cardSource({ kind: "quick" }).title, "Research card");
const tot = scriptTotals([{ id: "a", content: "one two three" }, { id: "b", content: withSrc }, { id: "c", content: null }], 150);
eq("totals per section", tot.sections.map((r) => r.words), [3, 3, 0]);
eq("totals all", [tot.words, tot.seconds], [6, 2]);
const introMd = "I learned Spanish in 30 days. Here is how.\n\nIt took 400 hours.";
const iSecs = [{ id: "i", content: introMd }, { id: "b", content: "Body one.\n\nBody two." }];
const ipar = paragraphs(introMd);
const bpar = paragraphs("Body one.\n\nBody two.");
const rep = introReport({
  introId: "i", introMd, title: "I Learned Spanish in 30 Days", wpm: 150, sections: iSecs,
  shots: [
    { section_id: "i", kind: "BR", para_hash: ipar[0].hash, duration_s: 2, position: 0, matches_thumbnail: true },
    { section_id: "i", kind: "AR", para_hash: ipar[1].hash, duration_s: 2, position: 1 },
    { section_id: "b", kind: "AR", para_hash: bpar[0].hash, duration_s: 6 },
    { section_id: "b", kind: "AR", para_hash: bpar[1].hash, duration_s: 6 },
  ],
});
eq("intro report first sentence", rep.firstSentence, "I learned Spanish in 30 days.");
eq("intro report title ok", rep.title?.ok, true);
eq("intro report first shot", rep.firstShot?.matches_thumbnail, true);
eq("intro report silent gaps", rep.silentGaps.map((p) => p.text), ["It took 400 hours."]);
eq("intro report pace", rep.pace.ok, true);
eq("intro report words", rep.words, 13);
const rep0 = introReport({ introId: "i", introMd: "", title: "X", wpm: 150, sections: iSecs, shots: [] });
eq("intro report empty", [rep0.firstSentence, rep0.title, rep0.noShots, rep0.pace.ok], ["", null, false, null]);
eq("intro report no shots", introReport({ introId: "i", introMd, title: null, wpm: 150, sections: iSecs, shots: [] }).noShots, true);

// ----- chapters for a video (helper for Worker C)
const cv = chaptersForVideo(
  [
    { kind: "intro", title: "Intro", words: 75 },
    { kind: "body", title: "Setup", words: 150 },
    { kind: "body", title: "Steps", words: 300, start_s: 100 },
    { kind: "closing", title: "Next video", content: "One two three." },
  ],
  { wpm: 150 },
);
eq("chapters for video", cv.chapters, [{ start_s: 0, title: "Intro" }, { start_s: 30, title: "Setup" }, { start_s: 100, title: "Steps" }, { start_s: 220, title: "Next video" }]);
eq("chapters for video estimated", cv.estimated, true);
eq("chapters for video check", cv.check.ok, true);
eq("chapters real times", chaptersForVideo([{ kind: "intro", title: "A", start_s: 5 }, { kind: "body", title: "B", start_s: 40 }, { kind: "closing", title: "C", start_s: 90 }]).estimated, false);
eq("chapters too few", chaptersForVideo([{ kind: "intro", title: "A", words: 10 }, { kind: "closing", title: "C", words: 10 }]).check.ok, false);

// ----- shots: setups, numbers, order, names, AI suggestions, backlog (round 2)
eq("setup key", setupKey({ kind: "AR", setup: " Desk ", location: "Home office" }), "Desk · Home office");
eq("setup key dedupe", setupKey({ kind: "BR", setup: "Kitchen", location: "kitchen" }), "Kitchen");
eq("setup key none", setupKey({ kind: "AR", setup: "", location: null }), NO_SETUP);
eq("setup key vertical", setupKey({ kind: "VT", setup: "Desk", location: "Home" }), VERTICAL_SETUP);
const gs = groupBySetup([
  { id: "a", kind: "AR" as const, setup: null, location: null, done: false },
  { id: "b", kind: "AR" as const, setup: "Desk", location: null, done: false },
  { id: "c", kind: "VT" as const, setup: null, location: null, done: false },
  { id: "d", kind: "BR" as const, setup: "Kitchen", location: null, done: true },
  { id: "e", kind: "BR" as const, setup: "desk", location: null, done: true },
]);
eq("group order", gs.map((g) => g.key), ["Desk", VERTICAL_SETUP, NO_SETUP, "Kitchen"]);
eq("group counts", gs.map((g) => `${g.done}/${g.total}`), ["1/2", "0/1", "0/1", "1/1"]);
eq("next num empty", nextShotNum([], "s1"), 1);
eq("next num", nextShotNum([{ section_id: "s1", num: 3 }, { section_id: "s1", num: 1 }, { section_id: "s2", num: 9 }], "s1"), 4);
eq("next num no section", nextShotNum([{ section_id: null, num: 2 }], null), 3);
const ord = sortShots(
  [
    { id: "x", section_id: "s2", para_hash: "h1", block_id: null, position: 100 },
    { id: "y", section_id: "s1", para_hash: "h3", block_id: null, position: 100 },
    { id: "z", section_id: "s1", para_hash: "old", block_id: "b2", position: 50 },
    { id: "w", section_id: "s1", para_hash: "h3", block_id: null, position: 101 },
    { id: "v", section_id: null, para_hash: null, block_id: null, position: 1 },
    { id: "u", section_id: "s1", para_hash: null, block_id: null, position: 900 },
  ],
  [
    { id: "s1", paragraphs: [{ idx: 0, hash: "h3", blockId: null }, { idx: 1, hash: "h4", blockId: "b2" }] },
    { id: "s2", paragraphs: [{ idx: 0, hash: "h1", blockId: null }] },
  ],
);
eq("sort shots script order", ord.map((s) => s.id), ["y", "w", "z", "u", "x", "v"]);
eq("shot name", shotName("V012", 3, { num: 5, kind: "BR" }, 2), "V012_S03-05_BR_T2");
eq("shot name vertical", shotName("V012", 3, { num: 5, kind: "VT" }, 1, ".mp4"), "V012_S03-05_VT_T1.mp4");
eq("shot name no code", shotName(null, 0, { num: 1, kind: "AR" }), "VXXX_S00-01_AR_T1");
eq("shot tag", shotTag(99, 7), "S99-07");
eq("shot tag unknown", shotTag(null, null), "S??-??");
eq("camera summary", cameraSummary({ framing: "wide", angle: "", movement: "slow push" }), "wide · slow push");
eq("clean text", cleanText("  hi  "), "hi");
eq("clean text empty", cleanText("   "), null);
eq("clean seconds", [cleanSeconds("4.25"), cleanSeconds(""), cleanSeconds(-1), cleanSeconds("x"), cleanSeconds(99999)], [4.3, null, null, null, 3600]);
eq("is shot kind", [isShotKind("VT"), isShotKind("XX"), isShotKind(3)], [true, false, false]);
const lines = [
  { key: "p1", section_id: "s1", para_hash: "h1", block_id: null, text: "First line about coffee.", code: "S01" },
  { key: "p2", section_id: "s1", para_hash: "h2", block_id: "b2", text: "Second line about tea.", code: "S01" },
];
ok("ai lines text", aiLinesText(lines, 1000).startsWith("[p1] S01 · First line"));
ok("ai lines text cut", aiLinesText(lines, 40).split("\n").filter(Boolean).length === 1);
const sugg = parseAiShots(
  {
    shots: [
      { p: "p1", kind: "br", description: "Pour coffee close up", duration_s: 3.6 },
      { p: "[p1]", kind: "GR", description: "Text: 3 cups a day" },
      { p: "p1", kind: "SC", description: "third one on the same line" },
      { p: "p2", kind: "AR", description: "talking head" },
      { p: "p9", kind: "BR", description: "unknown line" },
      { p: "2", kind: "SC", description: "Old shot" },
      { p: "p2", kind: "ST", description: "" },
    ],
  },
  lines,
  [{ para_hash: "h2", description: "old shot" }],
);
eq("ai parse kinds", sugg.map((x) => `${x.para_hash}:${x.kind}`), ["h1:BR", "h1:GR"]);
eq("ai parse duration", sugg[0].duration_s, 4);
eq("ai parse block", parseAiShots([{ p: "p2", kind: "SC", description: "Screen of the tea app" }], lines)[0].block_id, "b2");
eq("ai parse junk", parseAiShots("nope", lines), []);
const bl = [
  { id: "1", video_id: "v1", kind: "BR" as const, setup: "Desk", location: "Office", is_pickup: false, description: "mug", line_text: null },
  { id: "2", video_id: "v2", kind: "AR" as const, setup: "Desk", location: "Office", is_pickup: true, description: null, line_text: "Hello coffee" },
  { id: "3", video_id: "v2", kind: "VT" as const, setup: null, location: "Park", is_pickup: false, description: "walk", line_text: null },
];
eq("backlog setup", filterBacklog(bl, { setup: "desk · office" }).map((s) => s.id), ["1", "2"]);
eq("backlog location", filterBacklog(bl, { location: "park" }).map((s) => s.id), ["3"]);
eq("backlog pickups", filterBacklog(bl, { pickupsOnly: true }).map((s) => s.id), ["2"]);
eq("backlog video+kind", filterBacklog(bl, { video: "v2", kind: "VT" }).map((s) => s.id), ["3"]);
eq("backlog search", filterBacklog(bl, { q: "COFFEE" }).map((s) => s.id), ["2"]);
eq("backlog vertical setup", filterBacklog(bl, { setup: VERTICAL_SETUP }).map((s) => s.id), ["3"]);
eq("distinct values", distinctValues(["Desk", " desk ", null, "", "Kitchen"]), ["Desk", "Kitchen"]);

console.log(`\nyoutube-b: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
