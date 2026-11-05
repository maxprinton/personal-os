// Worker C — tests of the pure logic: outlier finder + watchlist, follow-up baselines, A/B, publish rules,
// weekly review, token encryption and API-answer parsing (JSON fixtures shaped like the real Google answers).
// Run: npm run test:youtube-c
import {
  ageDays, applyFinder, buildCandidates, channelMedian, finderSearchParams, formatCount, formatDuration, isShortDuration, median, outlierScore,
  parseChannels, parseIsoDuration, parseVideoId, parseVideos, playlistVideoIds, prefilter, referenceRow, rejectReason, searchChannelIds, searchVideoIds,
  watchChannelDue, watchOutlierRows, watchOutliers, withFilterDefaults, type OutlierCandidate, type VideoStat,
} from "@/lib/youtube/outliers";
import {
  baselineFor, calibrationSummary, checkinsFor, metricsLine, pearson, pushStat, ratioText, retentionBySection, shortTestPassed, verdictOf, viewsAt,
  viewsBetween, type BaselinePoint,
} from "@/lib/youtube/baseline";
import { equalWindows, judgeSwap, learningTable, swapAdvice, thumbAttrs, titleAttrs, topLessons, windowReady, type LearningRow } from "@/lib/youtube/abtest";
import {
  buildDescription, buildTitleSwap, buildVideoUpdate, chapterProblems, chaptersFromSections, chaptersText, checkPublish, chunkText, hookPreview, parseChaptersText,
  parseStamp, parseTags, publishAtUtc, requiredLangs, scriptToCaptionText, stamp, studioChecklist, tagsLength, type PublishCheckInput,
} from "@/lib/youtube/publish-rules";
import * as R2 from "@/lib/youtube/publish-rules";
import { jsWeekday, weekdayName, weeklyDue, weeklyText, weekRange, type WeeklyData } from "@/lib/youtube/weekly";
import { decryptToken, encryptToken, tokenKey } from "@/lib/youtube/server/token-crypto";
import { reportRows } from "@/lib/youtube/server/yt-analytics";
import { friendlyApiError, parseThreads } from "@/lib/youtube/server/yt-data";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// ===== outliers.ts ==================================================================================
eq("dur h:m:s", parseIsoDuration("PT1H2M3S"), 3723);
eq("dur days", parseIsoDuration("P1DT2H"), 93600);
eq("dur secs", parseIsoDuration("PT45S"), 45);
eq("dur P0D", parseIsoDuration("P0D"), 0);
eq("dur PT", parseIsoDuration("PT"), null);
eq("dur junk", parseIsoDuration("1:20"), null);
eq("dur null", parseIsoDuration(null), null);
eq("short 180", isShortDuration(180), true);
eq("short 181", isShortDuration(181), false);
eq("short 0", isShortDuration(0), false);
eq("short null", isShortDuration(null), false);

const videosJson = {
  items: [
    {
      id: "aaaaaaaaaaa",
      snippet: { publishedAt: daysAgo(30), channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Learn 100 words", channelTitle: "Chan A", thumbnails: { default: { url: "d.jpg" }, high: { url: "h.jpg" } } },
      contentDetails: { duration: "PT12M5S" },
      statistics: { viewCount: "450000", likeCount: "9000", commentCount: "300" },
    },
    { id: "bbbbbbbbbbb", snippet: { publishedAt: daysAgo(20), channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", title: "Short one", channelTitle: "Chan B" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "2000000" } },
    { snippet: { title: "no id" } },
    { id: "ccccccccccc", snippet: { publishedAt: daysAgo(3), channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Hidden stats" }, contentDetails: { duration: "PT9M" }, statistics: {} },
  ],
};
const vids = parseVideos(videosJson);
eq("parseVideos count (skip no id)", vids.length, 3);
eq("parseVideos first", { ...vids[0] }, {
  id: "aaaaaaaaaaa", title: "Learn 100 words", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Chan A", publishedAt: daysAgo(30), thumbnail: "h.jpg",
  durationS: 725, isShort: false, views: 450000, likes: 9000, comments: 300,
});
eq("parseVideos short", vids[1].isShort, true);
eq("parseVideos hidden views → null", vids[2].views, null);
eq("parseVideos null json", parseVideos(null), []);

const chans = parseChannels({
  items: [
    { id: "UCaaaaaaaaaaaaaaaaaaaaaa", snippet: { title: "Chan A", customUrl: "@chana" }, statistics: { subscriberCount: "120000", videoCount: "80" }, contentDetails: { relatedPlaylists: { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" } } },
    { id: "UCbbbbbbbbbbbbbbbbbbbbbb", snippet: { title: "Chan B", customUrl: "chanb" }, statistics: { subscriberCount: "999", hiddenSubscriberCount: true } },
  ],
});
eq("parseChannels handle @", chans[0].handle, "@chana");
eq("parseChannels handle add @", chans[1].handle, "@chanb");
eq("parseChannels subs", chans[0].subs, 120000);
eq("parseChannels hidden subs", [chans[1].subs, chans[1].hiddenSubs], [null, true]);
eq("parseChannels uploads fallback UU", chans[1].uploadsPlaylist, "UUbbbbbbbbbbbbbbbbbbbbbb");

eq(
  "searchVideoIds dedupe + only videos",
  searchVideoIds({ items: [{ id: { kind: "youtube#video", videoId: "x1" } }, { id: { kind: "youtube#channel", channelId: "UCz" } }, { id: { kind: "youtube#video", videoId: "x1" } }, { id: { videoId: "x2" } }] }),
  ["x1", "x2"],
);
eq("searchChannelIds", searchChannelIds({ items: [{ id: { kind: "youtube#channel", channelId: "UC1" } }, { snippet: { channelId: "UC2" } }, { id: { channelId: "UC1" } }] }), ["UC1", "UC2"]);
eq("playlistVideoIds", playlistVideoIds({ items: [{ contentDetails: { videoId: "v1" } }, { snippet: { resourceId: { videoId: "v2" } } }, {}] }), ["v1", "v2"]);

eq("median odd", median([3, 1, 2]), 2);
eq("median even", median([4, 1, 3, 2]), 2.5);
eq("median empty", median([]), null);
eq("median skips null", median([null, 5, undefined]), 5);
eq("ageDays", ageDays(daysAgo(10), NOW), 10);
eq("ageDays null", ageDays(null, NOW), null);

const up = (id: string, views: number | null, age: number, short = false): VideoStat => ({
  id, title: id, channelId: "UCw", channelTitle: "W", publishedAt: daysAgo(age), thumbnail: null, durationS: short ? 40 : 600, isShort: short, views, likes: null, comments: null,
});
const uploads = [up("l1", 1000, 30), up("l2", 2000, 20), up("l3", 3000, 10), up("l4", 50, 2), up("s1", 500, 15, true), up("s2", 700, 12, true), up("l5", null, 40)];
eq("channelMedian long (young & null left out)", channelMedian(uploads, { kind: "long", now: NOW }), 2000);
eq("channelMedian shorts (<3 mature → all)", channelMedian(uploads, { kind: "short", now: NOW }), 600);
eq("channelMedian lastN", channelMedian(uploads, { kind: "long", now: NOW, lastN: 2 }), 2500);
eq("channelMedian none", channelMedian([], { kind: "long", now: NOW }), null);

eq("score 3×", outlierScore(300000, 100000), 3);
eq("score rounds", outlierScore(1234, 1000), 1.2);
eq("score median 0", outlierScore(100, 0), null);
eq("score null views", outlierScore(null, 10), null);

eq("filter defaults", withFilterDefaults(null), { min_views: 100000, max_subs: 500000, min_outlier: 3, min_age_days: 14, max_results: 25, shorts: "exclude" });
eq("filter override", withFilterDefaults({ min_outlier: 5 }).min_outlier, 5);

const cand = (o: Partial<OutlierCandidate>): OutlierCandidate => ({
  id: "v", title: "t", channelId: "UC1", channelTitle: "C", publishedAt: daysAgo(30), thumbnail: null, durationS: 600, isShort: false,
  views: 500000, likes: null, comments: null, channelSubs: 100000, channelMedian: 100000, outlierScore: 5, url: "u", ...o,
});
const F = withFilterDefaults(null);
eq("reject pass", rejectReason(cand({}), F, NOW), null);
eq("reject shorts excluded", rejectReason(cand({ isShort: true }), F, NOW), "shorts");
eq("reject only shorts", rejectReason(cand({}), { ...F, shorts: "only" }, NOW), "shorts");
eq("reject only shorts passes short", rejectReason(cand({ isShort: true }), { ...F, shorts: "only" }, NOW), null);
eq("reject unknown views", rejectReason(cand({ views: null }), F, NOW), "unknown");
eq("reject views", rejectReason(cand({ views: 99999 }), F, NOW), "views");
eq("reject subs", rejectReason(cand({ channelSubs: 500000 }), F, NOW), "subs");
eq("hidden subs pass", rejectReason(cand({ channelSubs: null }), F, NOW), null);
eq("reject too new", rejectReason(cand({ publishedAt: daysAgo(5) }), F, NOW), "age");
eq("reject too old", rejectReason(cand({ publishedAt: daysAgo(400) }), { ...F, published_after_days: 365 }, NOW), "age");
eq("reject outlier", rejectReason(cand({ outlierScore: 2.9 }), F, NOW), "outlier");
eq("reject outlier unknown", rejectReason(cand({ outlierScore: null }), F, NOW), "outlier");
eq("prefilter ignores score", prefilter(cand({ outlierScore: null }), F, NOW), true);
eq("prefilter still checks views", prefilter(cand({ views: 10 }), F, NOW), false);

const built = buildCandidates([vids[0], vids[1]], new Map([["UCaaaaaaaaaaaaaaaaaaaaaa", { subs: 120000, median: 90000 }]]));
eq("buildCandidates score", built[0].outlierScore, 5);
eq("buildCandidates url long", built[0].url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
eq("buildCandidates short url + unknown channel", [built[1].url, built[1].channelSubs, built[1].outlierScore], ["https://www.youtube.com/shorts/bbbbbbbbbbb", null, null]);

const pool = [
  cand({ id: "a", outlierScore: 4, views: 400000 }),
  cand({ id: "b", outlierScore: 8, views: 800000 }),
  cand({ id: "c", outlierScore: 4, views: 900000 }),
  cand({ id: "d", outlierScore: 1, views: 100000 }),
  cand({ id: "e", isShort: true }),
  cand({ id: "f", views: 5000, outlierScore: 9 }),
];
const res = applyFinder(pool, { max_results: 2 }, { now: NOW, viewGoal: 500000 });
eq("applyFinder order + cut", res.outliers.map((c) => c.id), ["b", "c"]);
eq("applyFinder rejected", res.rejected, { outlier: 1, shorts: 1, views: 1 });
eq("applyFinder aboveGoal", res.aboveGoal, 3);
eq("applyFinder checked", res.checked, 6);
eq("applyFinder no goal", applyFinder(pool, null, { now: NOW }).aboveGoal, null);

eq("search params", finderSearchParams("  learn english  ", null, NOW), {
  part: "snippet", type: "video", q: "learn english", maxResults: "50", order: "relevance", publishedBefore: "2026-10-21T12:00:00Z", safeSearch: "none",
});
const sp = finderSearchParams("x", { shorts: "only", published_after_days: 365 }, NOW);
eq("search params shorts + after", [sp.videoDuration, sp.publishedAfter], ["short", "2025-11-04T12:00:00Z"]);

const wUploads = [up("w1", 9000, 3), up("w2", 1000, 4), up("w3", 4000, 60), up("w4", 3500, 10), up("ws", 9000, 2, true), up("ws2", 1000, 30, true), up("ws3", 1000, 31, true)];
eq("watchOutliers since last check (−14 d slack)", watchOutliers(wUploads.filter((u) => !u.isShort), 1000, { since: daysAgo(7), now: NOW }).map((u) => [u.id, u.outlierScore]), [["w1", 9], ["w4", 3.5]]);
eq("watchOutliers never checked = 30 d (+14)", watchOutliers(wUploads.filter((u) => !u.isShort), 1000, { since: null, now: NOW }).map((u) => u.id), ["w1", "w4"]);
eq("watchOutliers no median", watchOutliers(wUploads, null, { since: null, now: NOW }), []);
const wr = watchOutlierRows(wUploads, { long: 1000, short: 1000 }, { since: daysAgo(7), now: NOW, channelRowId: "row1", userId: "u1", known: new Set(["w4"]) });
eq("watchOutlierRows ids (known left out, shorts own median)", wr.map((r) => r.yt_id), ["w1", "ws"]);
eq("watchOutlierRows row", { ...wr[1], published_at: null }, {
  user_id: "u1", channel_row_id: "row1", yt_id: "ws", title: "ws", url: "https://www.youtube.com/shorts/ws", thumbnail_url: null, views: 9000, channel_median: 1000, outlier_score: 9, published_at: null, status: "new",
});
eq("watchChannelDue never", watchChannelDue(null, NOW, 7), true);
eq("watchChannelDue 6 d", watchChannelDue(daysAgo(6), NOW, 7), false);
eq("watchChannelDue 7 d − 10 min (slack)", watchChannelDue(new Date(NOW.getTime() - 7 * 86_400_000 + 10 * 60_000).toISOString(), NOW, 7), true);
eq("watchChannelDue bad date", watchChannelDue("nope", NOW, 7), true);

eq("formatCount small", formatCount(999), "999");
eq("formatCount K", formatCount(1234), "1.2K");
eq("formatCount 1K", formatCount(1000), "1K");
eq("formatCount M", formatCount(2_500_000), "2.5M");
eq("formatCount rounding edge → 1M", formatCount(999_960), "1M");
eq("formatCount B", formatCount(1_200_000_000), "1.2B");
eq("formatCount null", formatCount(null), "—");
eq("formatDuration m:ss", formatDuration(75), "1:15");
eq("formatDuration h", formatDuration(3723), "1:02:03");
eq("formatDuration null", formatDuration(null), "—");

eq("videoId bare", parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("videoId watch", parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ");
eq("videoId youtu.be", parseVideoId("youtu.be/dQw4w9WgXcQ?si=x"), "dQw4w9WgXcQ");
eq("videoId shorts", parseVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("videoId m.", parseVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("videoId other site", parseVideoId("https://vimeo.com/watch?v=dQw4w9WgXcQ"), null);
eq("videoId channel", parseVideoId("https://www.youtube.com/@name"), null);

const rr = referenceRow(built[0], "vid-1", "finder");
eq("referenceRow", rr, {
  video_id: "vid-1", yt_id: "aaaaaaaaaaa", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "Learn 100 words", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa", channel_title: "Chan A",
  channel_subs: 120000, views: 450000, channel_median: 90000, outlier_score: 5, published_at: daysAgo(30), thumbnail_url: "h.jpg", duration_s: 725, is_short: false, source: "finder",
});
eq("referenceRow fallbacks", (({ url, thumbnail_url, title }) => ({ url, thumbnail_url, title }))(referenceRow({ ...built[1], thumbnail: null, title: "", url: undefined } as never, null, "watchlist")), {
  url: "https://www.youtube.com/shorts/bbbbbbbbbbb", thumbnail_url: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg", title: "bbbbbbbbbbb",
});

// ===== baseline.ts ==================================================================================
eq("checkinsFor", checkinsFor("2026-11-01T10:00:00Z").map((c) => [c.kind, c.due_at]), [
  ["48h", "2026-11-03T10:00:00.000Z"], ["7d", "2026-11-08T10:00:00.000Z"], ["30d", "2026-12-01T10:00:00.000Z"], ["90d", "2027-01-30T10:00:00.000Z"],
]);
const pts: BaselinePoint[] = [100, 200, 300, 400, 500, 600].map((v, i) => ({ ytId: `y${i}`, kind: "long", checkin: "7d", views: v, at: daysAgo(60 - i * 7) }));
pts.push({ ytId: "s0", kind: "short", checkin: "7d", views: 99999, at: daysAgo(1) }, { ytId: "y5", kind: "long", checkin: "48h", views: 5, at: daysAgo(1) });
const b7 = baselineFor(pts, { kind: "long", checkin: "7d" });
eq("baseline history", [b7.views, b7.n, b7.source], [350, 6, "history"]);
eq("baseline lastN newest", baselineFor(pts, { kind: "long", checkin: "7d", lastN: 5 }).views, 400);
eq("baseline exclude self → 5 left", baselineFor(pts, { kind: "long", checkin: "7d", excludeYtId: "y0" }).views, 400);
eq("baseline too few → goal", baselineFor(pts, { kind: "long", checkin: "48h", viewGoal: 1000 }), { views: null, n: 1, source: "goal", goal: 1000 });
eq("baseline too few no goal", baselineFor(pts, { kind: "short", checkin: "7d" }).source, "none");
eq("verdict above", verdictOf(400, { views: 350, n: 6, source: "history" }), "above");
eq("verdict normal", verdictOf(330, { views: 350, n: 6, source: "history" }), "normal");
eq("verdict below", verdictOf(300, { views: 350, n: 6, source: "history" }), "below");
eq("verdict insufficient (goal)", verdictOf(300, { views: null, n: 2, source: "goal", goal: 1000 }), "insufficient");
eq("verdict no views", verdictOf(null, b7), "insufficient");
eq("ratioText ×", ratioText(700, b7), "2× the usual");
eq("ratioText %", ratioText(175, b7), "50 % of the usual");
eq("ratioText goal", ratioText(250, { views: null, n: 2, source: "goal", goal: 1000 }), "25 % of your view goal (not enough videos to compare yet: 2/5)");
eq("ratioText none", ratioText(10, { views: null, n: 0, source: "none" }), null);
eq("short test passed", shortTestPassed(700, b7), true);
eq("short test failed", shortTestPassed(699, b7), false);
eq("short test no baseline", shortTestPassed(9999, { views: null, n: 0, source: "none" }), false);

let hist = pushStat([], { at: "2026-11-01T00:00:00Z", views: 0 });
hist = pushStat(hist, { at: "2026-11-01T10:00:00Z", views: 1000 });
hist = pushStat(hist, { at: "2026-11-01T10:10:00Z", views: 1100 }); // replaces (within 30 min)
hist = pushStat(hist, { at: "2026-11-02T10:10:00Z", views: 3500 });
eq("pushStat merge", hist.map((h) => h.views), [0, 1100, 3500]);
eq("pushStat cap", pushStat(hist, { at: "2026-11-05T00:00:00Z", views: 9 }, 2).map((h) => h.views), [3500, 9]);
eq("viewsAt exact", viewsAt(hist, "2026-11-01T10:10:00Z"), 1100);
eq("viewsAt interpolate", viewsAt(hist, Date.parse("2026-11-01T22:10:00Z")), 2300);
eq("viewsAt before range", viewsAt(hist.slice(1), "2026-11-01T05:00:00Z"), null);
eq("viewsAt with publish 0", viewsAt(hist.slice(1), "2026-11-01T05:05:00Z", "2026-11-01T00:00:00Z"), 550);
eq("viewsAt after range", viewsAt(hist, "2026-11-09T00:00:00Z"), null);
eq("viewsBetween", viewsBetween(hist, Date.parse("2026-11-01T10:10:00Z"), Date.parse("2026-11-02T10:10:00Z")), 2400);
eq("viewsBetween unknown", viewsBetween(hist, 0, Date.parse("2026-11-02T10:10:00Z")), null);

const curve = Array.from({ length: 100 }, (_, i) => ({ t: (i + 1) / 100, pct: i < 30 ? 1 - i * 0.01 : 0.7 - (i - 30) * 0.003 }));
const rs = retentionBySection(curve, 600, [
  { id: "s2", title: "Body", start_s: 180 },
  { id: "s1", title: "Intro", start_s: 0 },
  { id: "s3", title: "No time", start_s: null },
  { id: "s4", title: "After end", start_s: 900 },
]);
eq("retention sections", rs.map((r) => [r.id, r.startS, r.endS, r.worst]), [["s1", 0, 180, true], ["s2", 180, 600, false]]);
eq("retention drops", rs.map((r) => r.drop), [0.29, 0.217]);
eq("retention no duration", retentionBySection(curve, null, []), []);

eq("pearson perfect", pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
eq("pearson negative", pearson([1, 2, 3], [3, 2, 1]), -1);
eq("pearson flat", pearson([1, 1, 1], [1, 2, 3]), null);
eq("pearson too few", pearson([1, 2], [1, 2]), null);
const cal = calibrationSummary([
  { videoId: "a", kind: "long", predictedViews: 1000, dataScore: 3, views7d: 400, views30d: 2000 },
  { videoId: "b", kind: "long", predictedViews: 1000, dataScore: 5, views7d: 500, views30d: null },
  { videoId: "c", kind: "long", predictedViews: null, dataScore: 7, views7d: 9000, views30d: 20000 },
  { videoId: "d", kind: "long", predictedViews: 1000, dataScore: 1, views7d: null, views30d: null },
]);
eq("calibration points", cal.points.map((p) => [p.at, p.ratio]), [["30d", 2], ["7d", 0.5], ["30d", null], [null, null]]);
eq("calibration n/ready/median", [cal.n, cal.ready, cal.medianRatio], [3, false, 1.25]);
eq("calibration correlation positive", (cal.scoreCorrelation ?? 0) > 0.5, true);
eq("metricsLine", metricsLine({ at: "x", views: 12345, ctr: 5.43, impressions: 200000, avg_view_pct: 41.6, subs_gained: 12 }), "12.3K views · CTR 5.4 % · 200K impressions · 42 % watched · +12 subs");
eq("metricsLine empty", metricsLine(null), "");

// ===== abtest.ts ====================================================================================
const hb = { views: 1000, n: 6, source: "history" as const };
eq("swap short", swapAdvice({ kind: "short", views48h: 1, base: hb, tests: [], alternatives: 2 }).suggest, false);
const tc = swapAdvice({ kind: "long", views48h: 100, base: hb, tests: [{ kind: "test_compare", ended_at: null }], alternatives: 2 });
eq("swap blocked by Test & compare", [tc.suggest, "blocked" in tc ? tc.blocked : null], [false, "test_compare"]);
eq("swap ended T&C does not block", swapAdvice({ kind: "long", views48h: 100, base: hb, tests: [{ kind: "test_compare", ended_at: "2026-11-01" }], alternatives: 2 }).suggest, true);
eq("swap already open", swapAdvice({ kind: "long", views48h: 100, base: hb, tests: [{ kind: "swap", ended_at: null }], alternatives: 2 }).suggest, false);
eq("swap no baseline", (swapAdvice({ kind: "long", views48h: 100, base: { views: null, n: 1, source: "goal" }, tests: [], alternatives: 2 }) as { blocked?: string }).blocked, "no_baseline");
eq("swap fine at 90 %", (swapAdvice({ kind: "long", views48h: 900, base: hb, tests: [], alternatives: 2 }) as { blocked?: string }).blocked, "fine");
eq("swap no alternative", (swapAdvice({ kind: "long", views48h: 500, base: hb, tests: [], alternatives: 0 }) as { blocked?: string }).blocked, "no_alternative");
eq("swap suggest", swapAdvice({ kind: "long", views48h: 500, base: hb, tests: [], alternatives: 1 }), { suggest: true, reason: "At 48 h it has 50 % of the usual views. Try another title + thumbnail pair." });

const w7 = equalWindows("2026-11-04T15:00:00Z", 7);
eq("equalWindows 7", w7, { before: { from: "2026-10-28", to: "2026-11-03" }, after: { from: "2026-11-05", to: "2026-11-11" }, sameWeekdays: true });
eq("equalWindows 2 month edge", equalWindows("2026-03-01T01:00:00Z", 2), { before: { from: "2026-02-27", to: "2026-02-28" }, after: { from: "2026-03-02", to: "2026-03-03" }, sameWeekdays: false });
eq("windowReady not yet", windowReady(w7.after, new Date("2026-11-13T12:00:00Z")), false);
eq("windowReady after delay", windowReady(w7.after, new Date("2026-11-14T00:00:00Z")), true);
eq("windowReady no delay", windowReady(w7.after, new Date("2026-11-12T00:00:00Z"), 0), true);

eq("judge CTR winner after", (({ verdict, winner, reliable }) => [verdict, winner, reliable])(judgeSwap({ impressions: 5000, ctr: 4 }, { impressions: 5000, ctr: 5 })), ["winner", "after", true]);
eq("judge CTR winner before", judgeSwap({ impressions: 5000, ctr: 5 }, { impressions: 5000, ctr: 4 }).winner, "before");
eq("judge CTR small change", judgeSwap({ impressions: 5000, ctr: 5 }, { impressions: 5000, ctr: 5.2 }).verdict, "no_clear_difference");
eq("judge too few impressions", judgeSwap({ impressions: 999, ctr: 2 }, { impressions: 5000, ctr: 9 }).verdict, "inconclusive");
eq("judge CTR before 0", judgeSwap({ impressions: 5000, ctr: 0 }, { impressions: 5000, ctr: 3 }).verdict, "inconclusive");
eq("judge views fallback winner", (({ verdict, winner, reliable }) => [verdict, winner, reliable])(judgeSwap({ views: 300 }, { views: 450 })), ["winner", "after", false]);
eq("judge views small", judgeSwap({ views: 300 }, { views: 350 }).verdict, "no_clear_difference");
eq("judge views too few", judgeSwap({ views: 100 }, { views: 450 }).verdict, "inconclusive");
eq("judge views missing", judgeSwap({}, { views: 450 }).verdict, "inconclusive");

eq("titleAttrs question+number", titleAttrs("How I Learned 500 Words in 30 Days?"), ["question", "number", "short title (≤40)"]);
eq("titleAttrs first person + negative + caps", titleAttrs("I made the WORST mistake learning English (don't do this)"), ["first person", "negative", "caps word", "medium title (41–60)"]);
eq("titleAttrs ESL not caps", titleAttrs("ESL tips for beginners"), ["short title (≤40)"]);
eq("titleAttrs versus/money long", titleAttrs("Duolingo vs a $20 teacher: which one really works better for adults learning"), ["number", "versus", "money", "long title (60+)"]);
eq("titleAttrs empty", titleAttrs("  "), []);
eq(
  "thumbAttrs",
  thumbAttrs({ gap_type: "result", stoppers: ["faces", "big_text"] as never, thumb_text: "30 DAYS", composition: "Split", contrast: ["color"] as never, attrs: { arrow: true, mood: "shock", n: 3 } as never }),
  ["gap: result", "stopper: faces", "stopper: big text", "face", "text on thumbnail", "composition: split", "contrast: color", "arrow", "mood: shock"],
);
eq("thumbAttrs bare", thumbAttrs({ gap_type: null, stoppers: [], thumb_text: null, composition: null, contrast: [], attrs: {} } as never), ["no face", "no text on thumbnail"]);

const pa = (id: string, attrs: string[]) => ({ pairId: id, label: id, title: id, attrs });
const lrows: LearningRow[] = [
  { testId: "1", videoId: "v1", kind: "test_compare", verdict: "winner", winner: pa("A", ["face", "number"]), losers: [pa("B", ["no face", "number"])], at: "x" },
  { testId: "2", videoId: "v2", kind: "swap", verdict: "winner", winner: pa("B", ["face", "question"]), losers: [pa("A", ["no face"])], at: "x" },
  { testId: "3", videoId: "v3", kind: "swap", verdict: "no_clear_difference", winner: null, losers: [pa("A", ["face"]), pa("B", ["no face"])], at: "x" },
];
const lt = learningTable(lrows);
const row = (a: string) => lt.find((s) => s.attr === a);
eq("learning face", row("face"), { attr: "face", wins: 2, losses: 0, ties: 1, tests: 3, winRate: 1 });
eq("learning no face", row("no face"), { attr: "no face", wins: 0, losses: 2, ties: 1, tests: 3, winRate: 0 });
eq("learning shared attr teaches nothing", row("number"), { attr: "number", wins: 0, losses: 0, ties: 0, tests: 1, winRate: null });
eq("learning order", lt[0].attr, "face");
eq("topLessons", topLessons(lt), ["face: 2 wins, 0 losses", "no face: 0 wins, 2 losses"]);

// ===== publish-rules.ts =============================================================================
eq("stamp 0", stamp(0), "0:00");
eq("stamp 75", stamp(75), "1:15");
eq("stamp h", stamp(3723), "1:02:03");
eq("parseStamp m:ss", parseStamp("1:15"), 75);
eq("parseStamp h", parseStamp("01:02:03"), 3723);
eq("parseStamp seconds", parseStamp("75"), 75);
eq("parseStamp bad", [parseStamp("1:75"), parseStamp("abc"), parseStamp("1:60:00")], [null, null, null]);

const secs = [
  { title: "", kind: "intro", start_s: 3, num: 0, position: 0 },
  { title: "Why it works", kind: "body", start_s: 65, num: 1, position: 1 },
  { title: "Dup start", kind: "body", start_s: 65, num: 2, position: 2 },
  { title: "No time", kind: "body", start_s: null, num: 3, position: 3 },
  { title: "Closing", kind: "closing", start_s: 300.7, num: 99, position: 4 },
];
const ch = chaptersFromSections(secs);
eq("chaptersFromSections", ch, [{ start_s: 0, title: "Intro" }, { start_s: 65, title: "Why it works" }, { start_s: 300, title: "Closing" }]);
eq("chapterProblems ok", chapterProblems(ch, 600), []);
eq("chapterProblems none allowed", chapterProblems([]), []);
eq("chapterProblems many", chapterProblems([{ start_s: 5, title: "A" }, { start_s: 10, title: "" }], 18), [
  "The first chapter must start at 0:00.", "YouTube needs at least 3 chapters.", "“A” is shorter than 10 s.", "“” is shorter than 10 s.", "The chapter at 0:10 has no title.",
]);
eq("chapterProblems order", chapterProblems([{ start_s: 0, title: "A" }, { start_s: 100, title: "C" }, { start_s: 50, title: "B" }]), ["Chapters must be in time order."]);
eq("chaptersText", chaptersText(ch), "0:00 Intro\n1:05 Why it works\n5:00 Closing");
eq("parseChaptersText", parseChaptersText("0:00 Intro\nnot a chapter\n1:05 - Why it works\n1:02:03 — End"), [{ start_s: 0, title: "Intro" }, { start_s: 65, title: "Why it works" }, { start_s: 3723, title: "End" }]);

const desc = buildDescription({ hook: "  I learned 500 words.\nHere is how. ", chapters: ch, links: ["▶ Watch next: https://youtu.be/x", " "], credits: [] });
eq("buildDescription", desc, "I learned 500 words.\nHere is how.\n\nChapters\n0:00 Intro\n1:05 Why it works\n5:00 Closing\n\n▶ Watch next: https://youtu.be/x");
eq("buildDescription custom template + credits", buildDescription({ hook: "H", chapters: [], links: [], credits: ["Song — Music Lab"], template: "{hook}\n\n{chapters}\n\n{credits}\n\nThanks" }), "H\n\nMusic\n• Song — Music Lab\n\nThanks");
eq("hookPreview", hookPreview("\nLine 1\n\nLine 2\nLine 3"), "Line 1\nLine 2");
eq("parseTags", parseTags("english, learn english,  English , <b>grammar</b>,,\nesl"), ["english", "learn english", "bgrammar/b", "esl"]);
eq("parseTags array", parseTags(["a", "A", " b "]), ["a", "b"]);
eq("tagsLength", tagsLength(["english", "learn english"]), 7 + 13 + 2 + 1);
eq("tagsLength empty", tagsLength([]), 0);
eq("publishAtUtc Caracas", publishAtUtc("2026-11-20", "09:00", "America/Caracas"), "2026-11-20T13:00:00Z");
eq("publishAtUtc bad", [publishAtUtc("20/11/2026", "09:00", "UTC"), publishAtUtc("2026-11-20", "25:00", "UTC")], [null, null]);

const okInput: PublishCheckInput = {
  kind: "long",
  fields: { title: "How I learned 500 words", description: desc, tags: ["english"], category_id: "27", privacy: "private", made_for_kids: false },
  localizations: { es: { title: "Cómo aprendí 500 palabras", description: "Descripción" } },
  requiredLangs: ["es"],
  chapters: ch,
  durationS: 600,
  introStatus: "filmed",
  thumbnail: { present: true, bytes: 500_000, width: 1280, height: 720 },
  now: NOW,
};
eq("checkPublish clean", checkPublish(okInput), { errors: [], warnings: [] });
eq("checkPublish intro gate", checkPublish({ ...okInput, introStatus: "final" }).errors.length, 1);
eq("checkPublish intro gate not for shorts", checkPublish({ ...okInput, kind: "short", introStatus: null, durationS: 50 }).errors, []);
const bad = checkPublish({
  ...okInput,
  fields: { ...okInput.fields, title: "x".repeat(101), description: "a <b>", tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`), publish_at: "2026-11-04T12:01:00Z", privacy: "public" },
  thumbnail: { present: true, bytes: 3_000_000, width: 1000, height: 1000 },
});
eq("checkPublish errors", bad.errors.map((e) => e.slice(0, 22)), ["Title has 101 characte", "YouTube does not allow", "Tags use 949 character", "The scheduled time mus", "The thumbnail is bigge"]);
eq("checkPublish warnings include 16:9 + private", [bad.warnings.some((w) => w.includes("16:9")), bad.warnings.some((w) => w.includes("Private"))], [true, true]);
eq("checkPublish soft title + missing ES", checkPublish({ ...okInput, fields: { ...okInput.fields, title: "y".repeat(65) }, localizations: {} }).warnings, [
  "Title has 65 characters: the end may be cut on phones (~60).", "The ES translation is not complete.",
]);
eq("checkPublish short too long", checkPublish({ ...okInput, kind: "short", durationS: 200 }).errors, ["A Short can be at most 180 s."]);

const current = {
  id: "vid11chars1",
  snippet: { title: "Old", description: "old", categoryId: "27", thumbnails: {}, channelTitle: "Me", publishedAt: "x", channelId: "UC", localized: {}, liveBroadcastContent: "none", defaultLanguage: "en" },
  status: { privacyStatus: "private", uploadStatus: "processed", madeForKids: false, license: "youtube" },
  localizations: { fr: { title: "Vieux", description: "v" } },
};
const upd = buildVideoUpdate(current, { title: " New ", description: "D", tags: ["t"], publish_at: "2099-01-01T10:00:00Z", privacy: "public", made_for_kids: false }, { es: { title: "Nuevo", description: "d" }, en: { title: "Same lang", description: "" } });
eq("videos.update parts", upd.parts, "snippet,status,localizations");
eq("videos.update snippet", upd.body.snippet, { title: "New", description: "D", categoryId: "27", defaultLanguage: "en", tags: ["t"] });
eq("videos.update status scheduled = private", upd.body.status, { privacyStatus: "private", license: "youtube", publishAt: "2099-01-01T10:00:00Z", selfDeclaredMadeForKids: false });
eq("videos.update localizations keep + add, skip default lang", (upd.body as { localizations?: unknown }).localizations, { fr: { title: "Vieux", description: "v" }, es: { title: "Nuevo", description: "d" } });
const pub = buildVideoUpdate({ ...current, status: { privacyStatus: "public" }, localizations: undefined, snippet: { title: "Old" } }, { publish_at: "2099-01-01T10:00:00Z" }, {}, { category_id: "22" });
eq("videos.update public stays public, default category", [pub.body.status, pub.body.snippet.categoryId, pub.parts], [{ privacyStatus: "public" }, "22", "snippet,status"]);
eq("videos.update past date ignored", buildVideoUpdate(current, { publish_at: "2020-01-01T00:00:00Z", privacy: "unlisted" }, {}).body.status.privacyStatus, "unlisted");
eq("title swap", buildTitleSwap(current, " B title "), { parts: "snippet", body: { id: "vid11chars1", snippet: { title: "B title", description: "old", categoryId: "27", defaultLanguage: "en" } } });

const md = `# Intro {color="blue" id="b1"}
Hey, today I show you **how** I learned [500 words](https://x.com) fast. {id="p1"}
> Source: Nation 2001

[B-roll: notebook]
- First, *pick* a [[Word list|list]].
1. Then \`review\` it daily.

| a | b |
\`\`\`
code
\`\`\`
Fuente: libro
See https://example.com now.`;
eq("scriptToCaptionText", scriptToCaptionText(md), "Hey, today I show you how I learned 500 words fast.\n\nFirst, pick a list.\nThen review it daily.\n\nSee now.");
eq("chunkText", chunkText("aaaa\n\nbbbb\n\ncccccccccccc", 10), ["aaaa\n\nbbbb", "cccccccccc", "cc"]);
eq("chunkText short", chunkText("hi", 100), ["hi"]);
eq("studioChecklist long", studioChecklist("long").map((c) => c.id), ["end_screen", "cards", "pinned_comment", "test_compare"]);
eq("studioChecklist short", studioChecklist("short").map((c) => c.id), ["related_video", "pinned_comment"]);
eq("requiredLangs", [requiredLangs("en"), requiredLangs("es-419"), requiredLangs(null)], [["es"], ["en"], ["es"]]);

// ===== weekly.ts ====================================================================================
eq("jsWeekday Wed", jsWeekday("2026-11-04"), 3);
eq("weekdayName", [weekdayName(0), weekdayName(9)], ["Sunday", "Sunday"]);
const prefs = { day: 0, time: "18:00", telegram: true, note: true };
eq("weeklyDue in window", weeklyDue(prefs, { date: "2026-11-08", minutes: 18 * 60 + 5 }), true);
eq("weeklyDue before time", weeklyDue(prefs, { date: "2026-11-08", minutes: 17 * 60 }), false);
eq("weeklyDue after window", weeklyDue(prefs, { date: "2026-11-08", minutes: 20 * 60 }), false);
eq("weeklyDue wrong day", weeklyDue(prefs, { date: "2026-11-09", minutes: 18 * 60 + 5 }), false);
eq("weeklyDue off", weeklyDue({ ...prefs, telegram: false, note: false }, { date: "2026-11-08", minutes: 18 * 60 + 5 }), false);
eq("weekRange", (({ from, to }) => [from, to])(weekRange("2026-11-08")), ["2026-11-02", "2026-11-08"]);
const wd: WeeklyData = {
  from: "2026-11-02", to: "2026-11-08", newIdeas: [{ label: "Idea A", source: "web" }, { label: "Idea B", source: "telegram" }],
  byStage: [{ stage: "script", videos: ["V003 · X"] }, { stage: "edit", videos: [] }], wipLimit: 1, wipCount: 2,
  checkins: [{ video: "V001", kind: "7d", verdict: "above", line: "2× the usual" }], dueSoon: [], tests: [], lessons: ["face: 2 wins, 0 losses"], pendingShots: [],
  newOutliers: [{ title: "Big video", score: 5, channel: "Chan" }], published: [],
};
const wt = weeklyText(wd, "https://app.test");
eq("weekly title", wt.title, "YouTube weekly · 2026-11-02 → 2026-11-08");
eq("weekly md sections", wt.markdown.split("\n").filter((l) => l.startsWith("## ")), ["## New ideas", "## Where each video is", "## Check-ins this week", "## Lessons so far", "## New outliers in watched channels"]);
eq("weekly md lines", [wt.markdown.includes("- Idea B (telegram)"), wt.markdown.includes("- Idea A\n"), wt.markdown.includes("⚠️ 2 videos in progress"), wt.markdown.includes("Big video (5×) — Chan")], [true, true, true, true]);
eq("weekly telegram link", wt.telegram.endsWith("Open: https://app.test/youtube/weekly"), true);
const quiet = weeklyText({ ...wd, newIdeas: [], byStage: [], wipCount: 0, checkins: [], lessons: [], newOutliers: [] });
eq("weekly quiet", quiet.markdown, "A quiet week: nothing new in the pipeline.");
const many = weeklyText({ ...wd, newIdeas: Array.from({ length: 7 }, (_, i) => ({ label: `I${i}`, source: "web" })) });
eq("weekly telegram cut", many.telegram.includes("• …and 2 more"), true);

// ===== token-crypto.ts ==============================================================================
const k = tokenKey("a-long-random-secret-for-tests-123")!;
eq("tokenKey length", k.length, 32);
eq("tokenKey short → null", [tokenKey("short"), tokenKey(""), tokenKey(undefined)], [null, null, null]);
const b64 = Buffer.alloc(32, 7).toString("base64");
eq("tokenKey base64 used as is", tokenKey(b64)!.equals(Buffer.alloc(32, 7)), true);
const enc = encryptToken("ya29.secret-token", k);
eq("encrypt format", [enc.split(".").length, enc.startsWith("v1."), enc.includes("secret")], [4, true, false]);
eq("encrypt random iv", encryptToken("ya29.secret-token", k) !== enc, true);
eq("decrypt roundtrip", decryptToken(enc, k), "ya29.secret-token");
eq("decrypt wrong key", decryptToken(enc, tokenKey("another-long-secret-key-xyz")!), null);
const parts = enc.split(".");
eq("decrypt tampered", decryptToken([parts[0], parts[1], parts[2], Buffer.from("x" + parts[3]).toString("base64url")].join("."), k), null);
eq("decrypt junk", [decryptToken("nope", k), decryptToken(null, k), decryptToken("v2.a.b.c", k)], [null, null, null]);

// ===== API answers (yt-data / yt-analytics) =========================================================
eq("reportRows", reportRows({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-11-01", 10], ["2026-11-02", 25]] }), [{ day: "2026-11-01", views: 10 }, { day: "2026-11-02", views: 25 }]);
eq("reportRows empty", reportRows(null), []);
const errOf = (status: number, reason: string, message = "") => friendlyApiError(status, { error: { code: status, message, errors: [{ reason }] } }).reason;
eq("api error quota", errOf(403, "quotaExceeded"), "quota");
eq("api error key", errOf(400, "badRequest", "API key not valid. Please pass a valid API key."), "key");
eq("api error disabled", errOf(403, "accessNotConfigured", "YouTube Data API v3 has not been used"), "disabled");
eq("api error auth", errOf(401, "authError"), "auth");
eq("api error forbidden", errOf(403, "forbidden", "The caller does not have permission"), "forbidden");
eq("api error 404", errOf(404, "videoNotFound"), "not_found");
eq("api error other", errOf(500, "backendError"), "api");
eq(
  "parseThreads",
  parseThreads({
    items: [
      { id: "t1", snippet: { totalReplyCount: 2, topLevelComment: { id: "c1", snippet: { textOriginal: "Great video!", authorDisplayName: "@ana", likeCount: 5, publishedAt: "2026-11-01T00:00:00Z" } } } },
      { snippet: {} },
    ],
  }),
  [{ id: "c1", text: "Great video!", author: "@ana", likes: 5, publishedAt: "2026-11-01T00:00:00Z", replies: 2 }],
);


// ===== publish-rules.ts — round 2 (publish page, captions, Shorts) ===================================
import2();
function import2() {
  eq("playlist id bare", R2.parsePlaylistId("PLabcdefghijKLMN"), "PLabcdefghijKLMN");
  eq("playlist id link", R2.parsePlaylistId("https://www.youtube.com/playlist?list=PLabcdefghij12"), "PLabcdefghij12");
  eq("playlist id from watch link", R2.parsePlaylistId("youtube.com/watch?v=dQw4w9WgXcQ&list=PLzzzzzzzzzzzz"), "PLzzzzzzzzzzzz");
  eq("playlist id junk", R2.parsePlaylistId("hello"), null);
  eq("playlist id other site", R2.parsePlaylistId("https://example.com/?list=PLabcdefghij12"), null);
  eq(
    "description links",
    R2.descriptionLinks({ watchNext: { title: "My next", ytId: "abcdefghijk" }, playlists: ["PL1234567890"], extra: "Instagram: @me\n\n" }),
    ["▶ Watch next: My next — https://www.youtube.com/watch?v=abcdefghijk", "📺 Playlist: https://www.youtube.com/playlist?list=PL1234567890", "Instagram: @me"],
  );
  eq("description links: watch-next not on YouTube", R2.descriptionLinks({ watchNext: { title: "x", ytId: null } }), []);
  eq(
    "music credits",
    R2.musicCredits([
      { track: "Calm pad", source: "music_lab", license: null, position: 2 },
      { track: "Lofi Song", source: "library", license: "YouTube Audio Library (no attribution)", position: 1 },
      { track: "lofi song", source: "library", license: "YouTube Audio Library (no attribution)", position: 3 },
      { track: "  ", source: "other", license: null },
    ]),
    ["Lofi Song — YouTube Audio Library (no attribution)", "Calm pad (original music)"],
  );
  eq("cleanHook keeps 2 lines", R2.cleanHook("a\n\n b \nc"), "a\nb");
  eq("hookOf", R2.hookOf("Line 1\nLine 2\n\nChapters\n0:00 Intro"), "Line 1\nLine 2");
  eq("hookOf starts with chapters", R2.hookOf("Chapters\n0:00 Intro"), "");
  const f0 = R2.initialFields({ title: "Pair A", defaults: { category_id: "28", privacy: "unlisted" }, kind: "long", current: null });
  eq("initialFields title/category/privacy", [f0.title, f0.category_id, f0.privacy, f0.made_for_kids, f0.synthetic_media, f0.default_language], ["Pair A", "28", "unlisted", false, false, "en"]);
  eq("initialFields keeps saved title", R2.initialFields({ title: "Pair A", defaults: {}, kind: "long", current: { title: "Edited", category_id: "22" } }).title, "Edited");
  eq("initialFields empty saved title → pair", R2.initialFields({ title: "Pair A", defaults: {}, kind: "long", current: { title: " " } }).title, "Pair A");

  // captions
  const strip = (md: string) => md.replace(/<details>[\s\S]*?<\/details>/g, "");
  eq(
    "captions from sections",
    R2.captionTextFromSections(
      [
        { kind: "intro", title: "Intro", content: "# Intro\nHi, I'm **Max**. [B-roll: classroom]\n<details><summary>📎 Source</summary>secret</details>" },
        { kind: "body", title: "Part", content: "> Source: some book\nThis is the [tip](https://x.com).\n🔊 whoosh" },
        { kind: "closing", title: "End", content: "" },
      ],
      strip,
    ),
    "Hi, I'm Max.\n\nThis is the tip.",
  );
  eq("drop cue lines", R2.dropCueLines("a\n🎵 calm music\n- ✂️ cut here\nb 🔊 not first"), "a\nb 🔊 not first");
  eq("caption words", R2.captionWords("Hi, I'm Max — it's 2026!"), 5);
  eq("caption warnings empty", R2.captionWarnings({ text: " ", wpm: 150, cutSeconds: 100 }).length, 1);
  const words150 = Array.from({ length: 150 }, () => "word").join(" ");
  eq("caption warnings normal (always the improvised reminder)", R2.captionWarnings({ text: words150, wpm: 150, cutSeconds: 65 }).length, 1);
  eq("caption warnings improvised (cut much longer)", R2.captionWarnings({ text: words150, wpm: 150, cutSeconds: 120 })[1]?.includes("improvised"), true);
  eq("caption warnings cut shorter", R2.captionWarnings({ text: words150, wpm: 150, cutSeconds: 30 })[1]?.includes("shorter"), true);
  const mp = R2.captionMultipart({ videoId: "abcdefghijk", language: "es", name: "Español", text: "Hola\nmundo", boundary: "BND" });
  eq("multipart starts", mp.startsWith("--BND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"), true);
  eq("multipart meta", mp.includes('{"snippet":{"videoId":"abcdefghijk","language":"es","name":"Español","isDraft":false}}'), true);
  eq("multipart text part", mp.includes("--BND\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHola\nmundo\r\n--BND--\r\n"), true);

  // published
  eq("published needs yt id", R2.publishedProblems({ ytId: null, publishedAt: null, now: NOW }).length, 1);
  eq("published ok", R2.publishedProblems({ ytId: "abcdefghijk", publishedAt: "2026-11-05T14:00:00Z", now: NOW }), []);
  eq("published bad date", R2.publishedProblems({ ytId: "abcdefghijk", publishedAt: "nope", now: NOW }), ["The publish date is not valid."]);
  eq("published far future", R2.publishedProblems({ ytId: "abcdefghijk", publishedAt: "2027-06-01T00:00:00Z", now: NOW }), ["The publish date is too far away."]);

  // Shorts
  eq("short range empty ok", R2.shortRangeProblems(null, null), []);
  eq("short range half", R2.shortRangeProblems(10, null), ["Give both the start and the end of the clip."]);
  eq("short range ok", R2.shortRangeProblems(65, 110, 600), []);
  eq("short range reversed", R2.shortRangeProblems(110, 65), ["The end must be after the start."]);
  eq("short range too long", R2.shortRangeProblems(0, 200)[0]?.startsWith("A Short can be at most 180 s"), true);
  eq("short range too short", R2.shortRangeProblems(10, 12), ["That clip is shorter than 5 seconds."]);
  eq("short range past the end", R2.shortRangeProblems(500, 560, 520), ["The long video is only 8:40 long."]);
  eq("short name", R2.shortName("Learn English fast", "teaser", 2), "Teaser 2 · Learn English fast");
  eq("short start stage cut", R2.shortStartStage({ hasRange: true }), "edit");
  eq("short start stage purpose", R2.shortStartStage({ hasRange: false }), "script");
  eq("purpose role test", R2.suggestPurposeRole(2), "test");
  eq("purpose role standalone", R2.suggestPurposeRole(0), "standalone");
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  eq("schedule teaser 1", R2.shortScheduleSuggestion({ longDate: "2026-11-01", role: "teaser", teaserIndex: 1, addDays: add, daysBetween: between }), "2026-11-03");
  eq("schedule teaser 2", R2.shortScheduleSuggestion({ longDate: "2026-11-01", role: "teaser", teaserIndex: 2, addDays: add, daysBetween: between }), "2026-11-06");
  eq("schedule purpose default", R2.shortScheduleSuggestion({ longDate: "2026-11-01", role: "standalone", teaserIndex: 0, addDays: add, daysBetween: between }), "2026-11-05");
  eq("schedule purpose before next long", R2.shortScheduleSuggestion({ longDate: "2026-11-01", role: "test", teaserIndex: 0, nextLongDate: "2026-11-15", addDays: add, daysBetween: between }), "2026-11-09");
  const sp = R2.shortPath({ hook: true, source: true, script: null, captions: false, related: false, published: false });
  eq("short path (cut: no script step)", [sp.steps.length, sp.next], [5, "Captions"]);
  eq("short path all done", R2.shortPath({ hook: true, source: true, script: true, captions: true, related: true, published: true }).next, null);
  eq("studio checklist short has related, no test&compare", R2.studioChecklist("short").map((x) => x.id), ["related_video", "pinned_comment"]);
  eq("urls", [R2.youtubeShortUrl("abcdefghijk"), R2.studioEditUrl("abcdefghijk")], ["https://www.youtube.com/shorts/abcdefghijk", "https://studio.youtube.com/video/abcdefghijk/edit"]);
}

console.log(`\nyoutube-c: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
