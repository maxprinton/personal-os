// YouTube add-on — Topic + Format = Idea, Idea + Angle = Killer idea (pure helpers).
// Run: npm run test:youtube-topics
import { cleanExtras, extrasOf, formatGrid, freeFormats, sameMix, similarTopics, takenBy, topicKey, topicNameFrom, topicStatus, usedAngles, type TopicIdea } from "@/lib/youtube/topics";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const idea = (o: Partial<TopicIdea> & { id: string }): TopicIdea => ({ idea_name: "x", stage: "bank", kind: "long", format: null, angle: null, published_at: null, ...o });

eq("key: case, accents, spaces", topicKey("  Cómo  ORGANIZO mi  Día "), "como organizo mi dia");
eq("key: ñ and ü", topicKey("Año Pingüino"), "ano pinguino");
eq("name: first sentence", topicNameFrom("Living cleaner with a calendar. Then notes and habits."), "Living cleaner with a calendar");
eq("name: long text is cut", topicNameFrom("a".repeat(300)).length, 118);
eq("name: empty", topicNameFrom("   "), "");

const ideas: TopicIdea[] = [
  idea({ id: "a", format: "tutorial", stage: "published", published_at: "2026-10-01", verdict30: "above", angle: "money" }),
  idea({ id: "b", format: "challenge", stage: "script", angle: "stakes" }),
  idea({ id: "c", format: "vlog", stage: "archived", angle: "time" }),
  idea({ id: "s", format: "tutorial", kind: "short", stage: "bank" }),
];
const F = ["tutorial", "challenge", "breakdown", "vlog"];
eq("grid states", formatGrid(F, ideas).map((c) => [c.format, c.state]), [["tutorial", "published"], ["challenge", "active"], ["breakdown", "free"], ["vlog", "parked"]]);
eq("grid verdict", formatGrid(F, ideas)[0].verdict, "above");
eq("taken: same format blocked", takenBy(ideas, "tutorial")?.id, "a");
eq("taken: own idea does not block itself", takenBy(ideas, "tutorial", "a"), null);
eq("taken: parked frees the pair", takenBy(ideas, "vlog"), null);
eq("taken: Shorts do not count", takenBy([idea({ id: "s", kind: "short", format: "breakdown" })], "breakdown"), null);
eq("free formats", freeFormats(F, ideas), ["breakdown", "vlog"]);
eq("used angles (other ideas only)", usedAngles(ideas, "b").sort(), ["money", "time"]);

eq("status: nothing published", topicStatus([idea({ id: "1" })], 10), "untested");
eq("status: published, no result", topicStatus([idea({ id: "1", stage: "published" })], 10), "testing");
eq("status: few videos on the channel", topicStatus([idea({ id: "1", stage: "published", verdict30: "above" })], 3), "insufficient");
eq("status: works", topicStatus([idea({ id: "1", stage: "published", verdict30: "above" }), idea({ id: "2", stage: "published", verdict30: "normal" })], 8), "works");
eq("status: fails", topicStatus([idea({ id: "1", stage: "published", verdict30: "below" })], 8), "fails");
eq("status: mixed", topicStatus([idea({ id: "1", stage: "published", verdict30: "below" }), idea({ id: "2", stage: "published", verdict30: "above" })], 8), "mixed");
eq("status: all average is mixed", topicStatus([idea({ id: "1", stage: "published", verdict30: "normal" })], 8), "mixed");
eq("status: insufficient verdict is ignored", topicStatus([idea({ id: "1", stage: "published", verdict30: "insufficient" })], 8), "testing");

const topics = [{ name: "Daily calendar routine" }, { name: "Budget tracking" }];
eq("similar: contains", similarTopics(topics, "calendar").map((t) => t.name), ["Daily calendar routine"]);
eq("similar: exact first", similarTopics([{ name: "calendar routine" }, { name: "Calendar" }], "calendar").map((t) => t.name), ["Calendar", "calendar routine"]);
eq("similar: too short", similarTopics(topics, "ca"), []);

// ----- mixes: main format + up to 2 mixed-in; lead angle + up to 2 supporting
const ALL = ["tutorial", "challenge", "breakdown", "vlog", "interview", "commentary"];
eq("extras: all but the main one", extrasOf(["challenge", "vlog", "tutorial"], "challenge"), ["vlog", "tutorial"]);
eq("extras: max 2, no duplicates", extrasOf(["a", "b", "b", "c", "d"], "a"), ["b", "c"]);
eq("extras: no main means none", extrasOf(["vlog"], null), []);
eq("clean: invalid and main removed", cleanExtras(["vlog", "nope", "challenge", "tutorial", "breakdown"], "challenge", ALL), ["vlog", "tutorial"]);
eq("clean: no main means none", cleanExtras(["vlog"], null, ALL), []);
const mixIdeas: TopicIdea[] = [idea({ id: "m1", format: "challenge", formats: ["challenge", "vlog"], stage: "script" })];
eq("mix: only the main format blocks", takenBy(mixIdeas, "vlog"), null);
eq("mix: main format still blocks", takenBy(mixIdeas, "challenge")?.id, "m1");
eq("mix: same set, other main → warning", sameMix(mixIdeas, "vlog", ["challenge"])?.id, "m1");
eq("mix: same main is not a 'swap'", sameMix(mixIdeas, "challenge", ["vlog"]), null);
eq("mix: different set → no warning", sameMix(mixIdeas, "vlog", ["tutorial"]), null);
eq("mix: no extras → no warning", sameMix(mixIdeas, "vlog", []), null);
eq("mix: parked idea does not warn", sameMix([idea({ id: "p", format: "challenge", formats: ["challenge", "vlog"], stage: "archived" })], "vlog", ["challenge"]), null);
eq("grid shows the mix", formatGrid(["challenge", "vlog"], mixIdeas)[0].mixed, ["vlog"]);
eq("grid: vlog cell stays free", formatGrid(["challenge", "vlog"], mixIdeas)[1].state, "free");
eq("grid shows supporting angles", formatGrid(["challenge"], [idea({ id: "g", format: "challenge", angle: "stakes", angles: ["stakes", "time"] })])[0].extraAngles, ["time"]);

console.log(`\nyoutube-topics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
