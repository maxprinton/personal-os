// Tests of Worker A's pure logic: src/lib/youtube/{scoring,package,research}.ts
// Run: npm run test:youtube-a
import { isYoutubeSummary, parseYoutubeCapture } from "@/lib/bot/youtube-capture";
import {
  addsToWip, canApprove, cleanRatings, cleanWeights, dataScore, fmtViews, gateStatus, ideaFromText, ideaScore, median, nextStage, nextStep, outlierOf,
  parseCapture, parseCount, parseYoutubeLinks, prevStage, sortBank, wipStatus, youtubeId, type BoardVideo,
} from "@/lib/youtube/scoring";
import {
  containment, fitInside, isImageUrl, nextPairLabel, packageMissing, previewTitle, similarity, splitFirstWords, suggestPairs, thumbTestsPassed, thumbWarnings, titleWarnings, words,
} from "@/lib/youtube/package";
import {
  bucketName, cleanUrl, defaultBuckets, ensureBlockId, findBlockForQuote, keywords, labOverview, moveItem, noteHref, plainLine, positionBetween, siteOf, splitBlocks, suggestNotes, usedIn, recurringTerms, filterDrawerNotes,
} from "@/lib/youtube/research";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const ok = (name: string, cond: boolean) => eq(name, cond, true);

// ===== scoring: gates ======================================================================
eq("gates empty → pending", gateStatus({}), "pending");
eq("gates null → pending", gateStatus(null), "pending");
eq("gates partial yes → pending", gateStatus({ feasibility: true, brand: true }), "pending");
eq("gates all yes → pass", gateStatus({ feasibility: true, brand: true, packageability: true }), "pass");
eq("gates one no → fail", gateStatus({ feasibility: true, brand: false, packageability: null }), "fail");
eq("gates notes ignored", gateStatus({ feasibility: true, brand: true, packageability: true, notes: "x" }), "pass");

// ===== ratings / weights ===================================================================
eq("cleanRatings keeps valid, clamps, drops unknown", cleanRatings({ excitement: 12, confidence: "7", effort: 0, foo: 3, new_audience: "x" }), { excitement: 10, confidence: 7, effort: 1 });
eq("cleanRatings non-object", cleanRatings(null), {});
eq("cleanWeights defaults", cleanWeights(null).view_potential, 2);
eq("cleanWeights override + bad", cleanWeights({ excitement: 3, confidence: -1 }), { view_potential: 2, excitement: 3, confidence: 1, effort: 1, new_audience: 1, existing_audience: 1 });

// ===== data score ==========================================================================
eq("outlier stored wins", outlierOf({ views: 100, channel_median: 10, outlier_score: 4 }), 4);
eq("outlier computed", outlierOf({ views: 300_000, channel_median: 100_000, outlier_score: null }), 3);
eq("outlier missing", outlierOf({ views: 300_000, channel_median: null, outlier_score: null }), null);
eq("median odd", median([5, 1, 3]), 3);
eq("median even", median([1, 2, 3, 10]), 2.5);
eq("median empty", median([]), null);
eq("dataScore no refs", dataScore([]).score, null);
eq("dataScore refs without numbers", dataScore([{ views: null, channel_median: null, outlier_score: null }]).score, null);
eq("dataScore 1× → 1", dataScore([{ views: 10, channel_median: 10, outlier_score: null }]).score, 1);
eq("dataScore 10× → 10", dataScore([{ views: 1000, channel_median: 100, outlier_score: null }]).score, 10);
eq("dataScore 3× ≈ 5.3", dataScore([{ views: null, channel_median: null, outlier_score: 3 }]).score, 5.3);
eq("dataScore 100× capped", dataScore([{ views: null, channel_median: null, outlier_score: 100 }]).score, 10);
{
  const d = dataScore(
    [
      { views: 500_000, channel_median: 50_000, outlier_score: null },
      { views: 50_000, channel_median: 50_000, outlier_score: null },
    ],
    100_000,
  );
  eq("dataScore with goal: above count", d.aboveGoal, 1);
  eq("dataScore with goal: n", d.n, 2);
  ok("dataScore with goal blended (between 1 and 10)", d.score! > 1 && d.score! < 10);
  ok("dataScore why mentions goal", d.why.includes("above your goal"));
}
eq("dataScore only goal data", dataScore([{ views: 200, channel_median: null, outlier_score: null }], 100).score, 10);

// ===== idea score ==========================================================================
eq("ideaScore nothing rated", ideaScore({}, null).score, null);
eq("ideaScore all 10, effort 1, vp 10 → 100", ideaScore({ excitement: 10, confidence: 10, effort: 1, new_audience: 10, existing_audience: 10 }, 10).score, 100);
eq("ideaScore all 1, effort 10, vp 1 → 0", ideaScore({ excitement: 1, confidence: 1, effort: 10, new_audience: 1, existing_audience: 1 }, 1).score, 0);
eq("ideaScore effort flips", ideaScore({ effort: 10 }, null).score, 0);
eq("ideaScore single item 5.5 → 50", ideaScore({ excitement: 10 }, 1, { excitement: 1, view_potential: 1 }).score, 50);
eq("ideaScore weight 0 ignores item", ideaScore({ excitement: 10 }, 1, { view_potential: 0 }).score, 100);
eq("ideaScore parts count", ideaScore({ excitement: 5, effort: 3 }, 7).parts.length, 3);
eq("ideaScore vp weighs double by default", ideaScore({ excitement: 1 }, 10).score, 67);

// ===== approve =============================================================================
eq("approve ok", canApprove({ stage: "idea", gates: { feasibility: true, brand: true, packageability: true }, idea_name: "x" }).ok, true);
eq("approve fail gate", canApprove({ stage: "bank", gates: { feasibility: false }, idea_name: "x" }).ok, false);
eq("approve pending", canApprove({ stage: "bank", gates: {}, idea_name: "x" }).reason, "Answer the 3 gates first.");
eq("approve already", canApprove({ stage: "package", gates: {}, idea_name: "x" }).reason, "Already approved.");
eq("approve needs name", canApprove({ stage: "bank", gates: { feasibility: true, brand: true, packageability: true }, idea_name: " " }).ok, false);

// ===== board ===============================================================================
const bv = (o: Partial<BoardVideo>): BoardVideo => ({
  id: "1", stage: "bank", step: "topic", kind: "long", idea_name: "n", topic: "t", formats: [], angles: [], gates: {}, ratings: {}, priority: 0, package_ready: false,
  created_at: "2026-11-01T00:00:00Z", stage_changed_at: "2026-11-01T00:00:00Z", ...o,
});
eq("sortBank by priority then newest", sortBank([bv({ id: "a", priority: 10 }), bv({ id: "b", priority: 50 }), bv({ id: "c", priority: 10, created_at: "2026-11-03T00:00:00Z" })]).map((v) => v.id), ["b", "c", "a"]);
eq("nextStep topic", nextStep(bv({})), "Check the topic: save references");
eq("nextStep format", nextStep(bv({ step: "format" })), "Pick a format");
eq("nextStep angle", nextStep(bv({ step: "angle", formats: ["tutorial"] })), "Pick an angle");
eq("nextStep gates", nextStep(bv({ step: "criteria", formats: ["tutorial"], angles: ["list"] })), "Answer the 3 gates");
eq("nextStep failed gate", nextStep(bv({ step: "criteria", formats: ["tutorial"], angles: ["list"], gates: { brand: false } })), "Failed a gate — rework or park");
eq("nextStep rate", nextStep(bv({ step: "criteria", formats: ["t"], angles: ["l"], gates: { feasibility: true, brand: true, packageability: true } })), "Rate the idea");
eq("nextStep approve", nextStep(bv({ step: "criteria", formats: ["t"], angles: ["l"], gates: { feasibility: true, brand: true, packageability: true }, ratings: { excitement: 5 } })), "Approve → Package");
eq("nextStep package titles", nextStep(bv({ stage: "package" })), "Write titles");
eq("nextStep package thumbs", nextStep(bv({ stage: "package" }), { titles: 2 }), "Sketch thumbnail concepts");
eq("nextStep package pair", nextStep(bv({ stage: "package" }), { titles: 2, thumbs: 1 }), "Pair + run the final tests");
eq("nextStep package ready", nextStep(bv({ stage: "package", package_ready: true }), { titles: 2, thumbs: 1 }), "Package ready → Research");
eq("nextStep research empty", nextStep(bv({ stage: "research" })), "Fill the research buckets");
eq("nextStep published", nextStep(bv({ stage: "published" })), "Follow-ups at 48 h · 7 · 30 · 90 days");
eq("wip under", wipStatus(["bank", "package", "script"], 3), { count: 2, limit: 3, over: false, atLimit: false });
eq("wip at", wipStatus(["package", "script", "edit", "published"], 3).atLimit, true);
eq("wip over", wipStatus(["package", "script", "edit", "publish"], 3).over, true);
eq("wip default limit", wipStatus([], null).limit, 3);
eq("addsToWip idea→package", addsToWip("idea", "package"), true);
eq("addsToWip package→research", addsToWip("package", "research"), false);
eq("addsToWip publish→published", addsToWip("publish", "published"), false);
eq("nextStage", nextStage("idea"), "package");
eq("nextStage published", nextStage("published"), null);
eq("nextStage archived", nextStage("archived"), null);
eq("prevStage package", prevStage("package"), "idea");
eq("prevStage bank", prevStage("bank"), null);

// ===== capture =============================================================================
eq("ideaFromText simple", ideaFromText("How I built my calendar"), { idea_name: "How I built my calendar", topic: "How I built my calendar" });
eq("ideaFromText first sentence", ideaFromText("Teach phrasal verbs with memes. Students love it and it works")?.idea_name, "Teach phrasal verbs with memes.");
eq("ideaFromText markdown heading", ideaFromText("# My idea\n\nmore text")?.idea_name, "My idea");
eq("ideaFromText empty", ideaFromText("   "), null);
ok("ideaFromText long cut ≤ 120", (ideaFromText("word ".repeat(80))?.idea_name.length ?? 999) <= 120);
eq("ideaFromText topic collapses spaces", ideaFromText("a\n\nb")?.topic, "a b");

// ===== YouTube links =======================================================================
eq("ytid watch", youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ");
eq("ytid short link", youtubeId("youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("ytid shorts", youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
eq("ytid mobile", youtubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("ytid embed", youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("ytid bare", youtubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("ytid other site", youtubeId("https://vimeo.com/123"), null);
eq("ytid channel", youtubeId("https://www.youtube.com/@mrbeast"), null);
eq(
  "parse links dedupe + shorts",
  parseYoutubeLinks("look https://youtu.be/dQw4w9WgXcQ, https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtube.com/shorts/abcdefghijk."),
  [
    { yt_id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", is_short: false },
    { yt_id: "abcdefghijk", url: "https://www.youtube.com/shorts/abcdefghijk", is_short: true },
  ],
);
eq("fmtViews", [fmtViews(950), fmtViews(1500), fmtViews(15_400), fmtViews(2_340_000), fmtViews(null)], ["950", "1.5K", "15K", "2.3M", "—"]);
eq("parseCount", [parseCount("12,000"), parseCount("12k"), parseCount("1.2M"), parseCount("1,2m"), parseCount(""), parseCount("1,234,567")], [12000, 12000, 1200000, 1200000, null, 1234567]);
ok("parseCount bad → NaN", Number.isNaN(parseCount("abc")));

// ===== package: words ======================================================================
eq("words drops stop words + accents", words("Cómo construí MI calendario en 30 días"), ["construi", "calendario", "30", "dias"]);
eq("similarity same", similarity("I built my own calendar app", "built own calendar app"), 1);
eq("similarity none", similarity("calendar app", "phrasal verbs"), 0);
eq("containment", containment("SAVED $1000", "How I saved $1000 in a month"), 1);

// ===== package: titles =====================================================================
eq("first words", splitFirstWords("I Built My Own Calendar And It Changed Everything", 4), { head: "I Built My Own", tail: " Calendar And It Changed Everything" });
eq("first words short title", splitFirstWords("Hello world", 4), { head: "Hello world", tail: "" });
eq("title empty", titleWarnings("  ").map((w) => w.kind), ["empty"]);
eq("title ok", titleWarnings("I Built My Own Calendar", { ideaName: "A video about the planner app I made with Next.js" }), []);
eq("title long", titleWarnings("x".repeat(65)).map((w) => w.kind), ["long"]);
eq("title cut", titleWarnings("word ".repeat(16)).map((w) => w.kind), ["cut"]);
eq("title repeats thumb", titleWarnings("I Saved $1000 In 30 Days", { thumbTexts: ["SAVED $1000"] }).map((w) => w.kind), ["repeats_thumb"]);
eq("title not repeating thumb", titleWarnings("I Tried Living On $1 A Day", { thumbTexts: ["DAY 7"] }).map((w) => w.kind), []);
eq("title like idea", titleWarnings("How I built my calendar app", { ideaName: "how I built my calendar app" }).map((w) => w.kind), ["like_idea"]);
eq("title duplicate", titleWarnings("Same", { otherTitles: ["same"] }).map((w) => w.kind), ["duplicate"]);
eq("title caps", titleWarnings("THIS IS ALL IN CAPITALS").map((w) => w.kind), ["caps"]);
eq("previewTitle short", previewTitle("Short title", 40), "Short title");
eq("previewTitle cut on word", previewTitle("One two three four five six seven", 18), "One two three…");

// ===== package: thumbnails =================================================================
eq("thumb warnings ok", thumbWarnings({ stoppers: ["faces"], thumb_text: "DAY 7", focal: "me", gap_type: "moment" }), []);
eq("thumb 3 stoppers info", thumbWarnings({ stoppers: ["a", "b", "c"], focal: "x", gap_type: "story" }).map((w) => w.level), ["info"]);
eq("thumb 4 stoppers warn", thumbWarnings({ stoppers: ["a", "b", "c", "d"], focal: "x", gap_type: "story" }).map((w) => w.level), ["warn"]);
eq("thumb too many words", thumbWarnings({ thumb_text: "one two three four five", focal: "x", gap_type: "story" }).length, 1);
eq("thumb missing gap + focal", thumbWarnings({}).length, 2);
eq("tests passed none", thumbTestsPassed({}, 1), { passed: 0, total: 4, missing: ["Clarity", "Contrast", "Glance", "Bonus"] });
eq("tests bonus auto with 3", thumbTestsPassed({ clarity: true, contrast: true, glance: true }, 3), { passed: 4, total: 4, missing: [] });
eq("pair label next", nextPairLabel(["A", "C"]), "B");
eq("pair label all used", nextPairLabel(["A", "B", "C", "D", "E", "F"]), null);
eq("suggest pairs", suggestPairs(["t1", "t2", "t3"], ["m1", "m2"]), [
  { label: "A", title_id: "t1", thumbnail_id: "m1" },
  { label: "B", title_id: "t2", thumbnail_id: "m2" },
]);
{
  const base = { gapKnown: "they know", gapWant: "they want", titles: [{ id: "t1", value: "Title" }], thumbs: [{ id: "m1", tests: { clarity: true, contrast: true, glance: true } }], pairs: [{ title_id: "t1", thumbnail_id: "m1", is_primary: true }] };
  eq("package ready", packageMissing(base), []);
  eq("package no gap", packageMissing({ ...base, gapWant: "" }).length, 1);
  eq("package no primary", packageMissing({ ...base, pairs: [{ title_id: "t1", thumbnail_id: "m1", is_primary: false }] }), ["Choose the primary pair"]);
  eq("package tests missing", packageMissing({ ...base, thumbs: [{ id: "m1", tests: { clarity: true } }] }), ["Final tests of the primary thumbnail: Contrast, Glance"]);
  eq("package empty", packageMissing({ gapKnown: null, gapWant: null, titles: [], thumbs: [], pairs: [] }).length, 4);
}
eq("fitInside", fitInside(2560, 1440, 1280, 720), { w: 1280, h: 720 });
eq("fitInside small stays", fitInside(640, 360, 1280, 720), { w: 640, h: 360 });
eq("fitInside tall", fitInside(1000, 2000, 1280, 720), { w: 360, h: 720 });
eq("isImageUrl", [isImageUrl("https://x.com/a.png"), isImageUrl("/api/files/u/a.webp"), isImageUrl("javascript:alert(1)"), isImageUrl("nope")], [true, true, false, false]);

// ===== research: keywords + suggestions ====================================================
eq("keywords", keywords("How I built my Personal OS calendar with Next.js"), ["built", "personal", "calendar", "next"]);
eq("keywords spanish", keywords("Cómo enseñar los phrasal verbs"), ["ensenar", "phrasal", "verbs"]);
{
  const notes = [
    { id: "1", title: "Calendar design notes", text: "drag and drop blocks", tags: ["personal-os"] },
    { id: "2", title: "Groceries", text: "milk eggs", tags: [] },
    { id: "3", title: "Ideas", text: "a calendar that syncs", tags: [] },
    { id: "4", title: "Personal finances", text: "budget", tags: ["personal"] },
  ];
  eq("suggest order", suggestNotes(notes, ["calendar", "personal"]).map((n) => n.id), ["1", "4", "3"]);
  eq("suggest exclude", suggestNotes(notes, ["calendar"], { exclude: ["1"] }).map((n) => n.id), ["3"]);
  eq("suggest none", suggestNotes(notes, []).length, 0);
  eq("suggest hits", suggestNotes(notes, ["calendar", "zzz"])[0].hits, ["calendar"]);
  eq("suggest word start only", suggestNotes([{ id: "x", title: "unpersonal", text: "" }], ["personal"]).length, 0);
}

// ===== research: blocks / fragments ========================================================
const md = [
  "# Title {id=\"h1\"}",
  "",
  "First **paragraph** with [a link](https://x.com).",
  "```",
  "code line",
  "```",
  "- a bullet {color=\"red\"}",
  "| a | b |",
  "Last line {color=\"blue\" id=\"k3x9\"}",
].join("\n");
eq("plainLine", plainLine("> **Bold** [x](y) {id=\"a\"}"), "Bold x");
eq("splitBlocks", splitBlocks(md).map((b) => [b.line, b.text, b.blockId, b.heading]), [
  [0, "Title", "h1", true],
  [2, "First paragraph with a link.", null, false],
  [6, "a bullet", null, false],
  [8, "Last line", "k3x9", false],
]);
eq("ensureBlockId plain", ensureBlockId(md, 2, "new1")?.md.split("\n")[2], "First **paragraph** with [a link](https://x.com). {id=\"new1\"}");
eq("ensureBlockId keeps color", ensureBlockId(md, 6, "new2")?.md.split("\n")[6], "- a bullet {color=\"red\" id=\"new2\"}");
eq("ensureBlockId existing", ensureBlockId(md, 8, "zzz"), { md, id: "k3x9" });
eq("ensureBlockId empty line", ensureBlockId(md, 1, "zzz"), null);
eq("ensureBlockId out of range", ensureBlockId(md, 99, "zzz"), null);
eq("findBlockForQuote exact", findBlockForQuote(md, "paragraph with a link")?.line, 2);
eq("findBlockForQuote words", findBlockForQuote("one two\n\nThe calendar syncs blocks every minute", "calendar syncs blocks every")?.line, 2);
eq("findBlockForQuote miss", findBlockForQuote(md, "totally unrelated words here"), null);
eq("noteHref", [noteHref("n1"), noteHref("n1", "abc")], ["/notes/n1", "/notes/n1#b-abc"]);

// ===== research: ordering, buckets, links ==================================================
eq("positionBetween", [positionBetween(null, null), positionBetween(null, 5), positionBetween(3, null), positionBetween(2, 3)], [1, 4, 4, 2.5]);
eq("moveItem", moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
eq("moveItem to end", moveItem(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
eq("moveItem bad index", moveItem(["a"], 5, 0), ["a"]);
eq("default buckets", defaultBuckets().map((b) => b.name).at(-1), "References");
eq("default buckets count", defaultBuckets().length, 6);
eq("bucketName unique", bucketName("Key points", ["Key points", "key points 2"]), "Key points 3");
eq("bucketName trims", bucketName("  New   one ", []), "New one");
eq("bucketName empty", bucketName("   ", []), null);
eq("cleanUrl adds https", cleanUrl("example.com/a"), "https://example.com/a");
eq("cleanUrl bad", [cleanUrl("not a link"), cleanUrl("ftp://x.com"), cleanUrl("")], [null, null, null]);
eq("siteOf", siteOf("https://www.nytimes.com/a/b"), "nytimes.com");

// ===== research: used in / overview ========================================================
{
  const vids = [
    { id: "v1", code: "V001", idea_name: "One", stage: "research" },
    { id: "v2", code: "V002", idea_name: "Two", stage: "script" },
  ];
  const cards = [
    { note_id: "n1", video_id: "v1", bucket_id: "b1", kind: "note" },
    { note_id: "n1", video_id: "v1", bucket_id: "b2", kind: "fragment" },
    { note_id: "n1", video_id: "v2", bucket_id: "b3", kind: "note" },
    { note_id: "n2", video_id: "v2", bucket_id: "b3", kind: "note" },
    { note_id: "n3", video_id: null, bucket_id: "s1", kind: "note" },
    { note_id: null, video_id: "v2", bucket_id: "b3", kind: "quick" },
  ];
  const u = usedIn(cards, vids);
  eq("usedIn n1 two videos once each", u.get("n1")?.map((v) => v.code), ["V001", "V002"]);
  eq("usedIn shelf not counted", u.has("n3"), false);
  const o = labOverview(cards, vids);
  eq("overview per video", o.perVideo.map((p) => [p.video.code, p.cards, p.notes]), [
    ["V002", 3, 2],
    ["V001", 2, 1],
  ]);
  eq("overview shared", o.shared.map((s) => s.noteId), ["n1"]);
  eq("overview shelf cards", o.shelfCards, 1);
  eq("overview byKind", o.perVideo[0].byKind, { note: 2, quick: 1 });
}

// ===== capture ============================================================================
eq("links: plain words are not ids", parseYoutubeLinks("programming is fun"), []);
eq("links: bare ids alone ok", parseYoutubeLinks("dQw4w9WgXcQ abcdefghijk").map((l) => l.yt_id), ["dQw4w9WgXcQ", "abcdefghijk"]);
eq("capture simple", parseCapture("How I built my calendar"), { idea_name: "How I built my calendar", topic: "How I built my calendar", kind: "long", links: [], quote: null });
eq("capture short prefix", parseCapture("short: 3 phrasal verbs in 30 s")?.kind, "short");
eq("capture short prefix name", parseCapture("short: 3 phrasal verbs in 30 s")?.idea_name, "3 phrasal verbs in 30 s");
eq("capture #shorts tag", parseCapture("Memes to teach English #shorts")?.idea_name, "Memes to teach English");
eq("capture #short kind", parseCapture("Memes to teach English #short")?.kind, "short");
{
  const c = parseCapture("Do this like https://youtu.be/dQw4w9WgXcQ but for teachers");
  eq("capture link removed from name", c?.idea_name, "Do this like but for teachers");
  eq("capture link kept", c?.links.map((l) => l.yt_id), ["dQw4w9WgXcQ"]);
}
{
  const c = parseCapture("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  eq("capture only link → empty name", c?.idea_name, "");
  eq("capture only link → 1 link", c?.links.length, 1);
}
eq("tg yt:", parseYoutubeCapture("yt: How I built my calendar"), "How I built my calendar");
eq("tg /yt", parseYoutubeCapture("/yt@MyBot memes for ESL"), "memes for ESL");
eq("tg yt short:", parseYoutubeCapture("yt short: 3 verbs"), "short: 3 verbs");
eq("tg yts:", parseYoutubeCapture("YTS: 3 verbs"), "short: 3 verbs");
eq("tg /yt alone", parseYoutubeCapture("/yt"), null);
eq("tg not capture", parseYoutubeCapture("buy milk"), null);
eq("tg summary", [isYoutubeSummary("/youtube"), isYoutubeSummary("yt"), isYoutubeSummary("yt: x")], [true, true, false]);
eq("tg short → capture kind", parseCapture(parseYoutubeCapture("yt short: 3 verbs") ?? "")?.kind, "short");
eq("capture empty", parseCapture("   "), null);
eq("capture only tag", parseCapture("#shorts"), null);
eq("capture long text quote", parseCapture("Teach with memes. Students love it.")?.quote, "Teach with memes. Students love it.");

// ===== research: recurring terms + drawer filter ===========================================
{
  const r = recurringTerms([
    { videoId: "a", text: "Teaching grammar with memes", tags: ["ESL"] },
    { videoId: "b", text: "Memes for vocabulary", tags: ["esl", "fun"] },
    { videoId: "c", text: "Grammar drills" },
  ]);
  eq("recurring: esl tag first", r[0], { term: "esl", videos: 2, tag: true });
  eq("recurring terms", r.map((x) => x.term).sort(), ["esl", "grammar", "memes"]);
  eq("recurring min 3 -> none", recurringTerms([{ videoId: "a", text: "memes" }, { videoId: "b", text: "memes" }], { min: 3 }), []);
  eq("recurring same video counts once", recurringTerms([{ videoId: "a", text: "memes memes" }, { videoId: "a", text: "memes" }]), []);
  const notes = [
    { id: "1", title: "Memes in class", text: "Students laugh", typeId: "idea", areaId: "trabajo", tags: ["ESL"] },
    { id: "2", title: "Budget", text: "money plan", typeId: "plan", areaId: "finanzas", tags: [] },
    { id: "3", title: "Canción", text: "música en clase", typeId: "idea", areaId: null, tags: ["esl"] },
  ];
  eq("drawer: no filter", filterDrawerNotes(notes, {}).length, 3);
  eq("drawer: q", filterDrawerNotes(notes, { q: "class" }).map((n) => n.id), ["1"]);
  eq("drawer: q accents", filterDrawerNotes(notes, { q: "cancion musica" }).map((n) => n.id), ["3"]);
  eq("drawer: type", filterDrawerNotes(notes, { type: "idea" }).map((n) => n.id), ["1", "3"]);
  eq("drawer: area", filterDrawerNotes(notes, { area: "finanzas" }).map((n) => n.id), ["2"]);
  eq("drawer: tag case-insensitive", filterDrawerNotes(notes, { tag: "Esl" }).map((n) => n.id), ["1", "3"]);
  eq("drawer: type + q", filterDrawerNotes(notes, { type: "idea", q: "laugh" }).map((n) => n.id), ["1"]);
}

console.log(`\nyoutube-a: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
