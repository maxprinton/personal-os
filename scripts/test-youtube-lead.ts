// YouTube add-on — Lead's pure helpers: constants, channel link, Telegram capture parsing.
// Run: npm run test:youtube-lead
import { BOARD_STAGES, OUTLINE_TEMPLATES, STAGES, VIDEO_TABS, WIP_STAGES, parseChannelUrl, sectionCode, stageInfo, videoLabel } from "@/lib/youtube/constants";
import { isYoutubeSummary, parseYoutubeCapture } from "@/lib/bot/youtube-capture";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}

eq("stage tabs exist", STAGES.every((s) => VIDEO_TABS.some((t) => t.id === s.tab)), true);
eq("board has no archived", BOARD_STAGES.includes("archived"), false);
eq("wip from package to publish", [WIP_STAGES[0], WIP_STAGES[WIP_STAGES.length - 1]], ["package", "publish"]);
eq("unknown stage → bank", stageInfo("zzz").id, "bank");
eq("templates: intro first, closing last, exactly one climax", Object.values(OUTLINE_TEMPLATES).every((t) => t[0].kind === "intro" && t[t.length - 1].kind === "closing" && t.filter((x) => x.is_climax).length === 1), true);
eq("section code", [sectionCode(0), sectionCode(3), sectionCode(99), sectionCode(null)], ["S00", "S03", "S99", "S??"]);
eq("video label", [videoLabel({ code: "V012", idea_name: "X" }), videoLabel({ code: null, idea_name: "Y" })], ["V012 · X", "Y"]);

eq("channel @", parseChannelUrl("https://www.youtube.com/@Max.Teaches"), { url: "https://www.youtube.com/@Max.Teaches", handle: "@Max.Teaches", channelId: null });
eq("channel bare @", parseChannelUrl("@maxteaches")?.handle, "@maxteaches");
eq("channel no https + m.", parseChannelUrl("m.youtube.com/@abc/videos")?.handle, "@abc");
eq("channel id", parseChannelUrl("https://youtube.com/channel/UC1234567890123456789012")?.channelId, "UC1234567890123456789012");
eq("channel /c/", parseChannelUrl("https://www.youtube.com/c/Name")?.url, "https://www.youtube.com/c/Name");
eq("not youtube", parseChannelUrl("https://vimeo.com/@x"), null);
eq("video link is not a channel", parseChannelUrl("https://www.youtube.com/watch?v=abc"), null);

eq("yt: capture", parseYoutubeCapture("yt: how I built my calendar"), "how I built my calendar");
eq("YouTube: capture (voice)", parseYoutubeCapture("YouTube: cómo enseño   phrasal verbs"), "cómo enseño phrasal verbs");
eq("/yt capture", parseYoutubeCapture("/yt my idea"), "my idea");
eq("/yt@Bot capture", parseYoutubeCapture("/yt@MyBot my idea"), "my idea");
eq("/yt alone is not a capture", parseYoutubeCapture("/yt"), null);
eq("yt: empty", parseYoutubeCapture("yt:   "), null);
eq("not a capture", parseYoutubeCapture("youtube video ideas"), null);
eq("summary /youtube", [isYoutubeSummary("/youtube"), isYoutubeSummary("/yt"), isYoutubeSummary("YouTube"), isYoutubeSummary("/yt idea")], [true, true, true, false]);

console.log(`\nyoutube-lead: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
