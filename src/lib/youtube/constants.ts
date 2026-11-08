// YouTube Pipeline add-on — every fixed list, label and YouTube rule in ONE place (risk 11: YouTube changes →
// edit here). Pure data + tiny helpers: safe on server, client and in tests.
import type {
  CheckinKind, ClipLocation, ClipStatus, ContrastKind, CueKind, EditPass, FinderFilters, GapType, GateKey, IdeaSource, IdeaStep,
  IntroStatus, LinkKind, MomentKind, OutlineTemplateSection, RatingKey, ScrollStopper, ShortRole, ShotKind, ThumbTestKey, VideoAngle,
  VideoFormat, WeeklyReviewPrefs, YtStage,
} from "@/lib/youtube/types";

export const ADDON_ID = "youtube";
export const BASE = "/youtube";
/** Migration file the user pastes in Supabase (shown when the tables are missing). */
export const MIGRATION_FILE = "MIGRACION-0031-youtube.sql";

// ----- Stages ----------------------------------------------------------------------------------------
export type StageInfo = { id: YtStage; label: string; hint: string; /** sub-route of /youtube/v/[id] where you work on it */ tab: VideoTab };
export const STAGES: StageInfo[] = [
  { id: "bank", label: "Idea bank", hint: "Captured, not developed yet", tab: "idea" },
  { id: "idea", label: "Ideation", hint: "Topic → Format → Angle → Criteria", tab: "idea" },
  { id: "package", label: "Package", hint: "Titles + thumbnails before the script", tab: "package" },
  { id: "research", label: "Research", hint: "Research Laboratory buckets", tab: "research" },
  { id: "outline", label: "Outline", hint: "Intro, parts, climax, closing", tab: "script" },
  { id: "script", label: "Script", hint: "One page per outline section", tab: "script" },
  { id: "shots", label: "Shot list", hint: "Shots from the script", tab: "shots" },
  { id: "filming", label: "Filming", hint: "Filming mode by setup", tab: "shots" },
  { id: "edit", label: "Editing", hint: "Clips, passes, versions", tab: "edit" },
  { id: "publish", label: "Publishing", hint: "Metadata, thumbnail, chapters, captions", tab: "publish" },
  { id: "published", label: "Published", hint: "Follow-ups at 48 h, 7, 30 and 90 days", tab: "follow-up" },
  { id: "archived", label: "Archived", hint: "Parked or dropped (never deleted)", tab: "idea" },
];
export const STAGE_ORDER: YtStage[] = STAGES.map((s) => s.id);
/** Board columns (archived is a filter, not a column). */
export const BOARD_STAGES: YtStage[] = STAGE_ORDER.filter((s) => s !== "archived");
/** "Work in progress" for the WIP limit: from Package to Publishing. */
export const WIP_STAGES: YtStage[] = ["package", "research", "outline", "script", "shots", "filming", "edit", "publish"];
export const BANK_STAGES: YtStage[] = ["bank", "idea"];

export function stageInfo(id: string): StageInfo {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
export function stageLabel(id: string) {
  return stageInfo(id).label;
}
export function stageIndex(id: string) {
  const i = STAGE_ORDER.indexOf(id as YtStage);
  return i < 0 ? 0 : i;
}
export function isStage(v: unknown): v is YtStage {
  return typeof v === "string" && (STAGE_ORDER as string[]).includes(v);
}
export function isWip(stage: string) {
  return (WIP_STAGES as string[]).includes(stage);
}

// ----- Video page tabs (/youtube/v/[id]/<tab>) --------------------------------------------------------
export type VideoTab = "idea" | "package" | "research" | "script" | "shots" | "edit" | "music" | "publish" | "follow-up";
export const VIDEO_TABS: { id: VideoTab; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "package", label: "Package" },
  { id: "research", label: "Research" },
  { id: "script", label: "Script" },
  { id: "shots", label: "Shots" },
  { id: "edit", label: "Edit" },
  { id: "music", label: "Music" },
  { id: "publish", label: "Publish" },
  { id: "follow-up", label: "Follow-up" },
];
/** Full-screen views of a video (no stage tabs): filming mode and teleprompter. */
export const VIDEO_FULLSCREEN = ["film", "prompter"] as const;
export const videoHref = (id: string, tab?: VideoTab | (typeof VIDEO_FULLSCREEN)[number]) => `${BASE}/v/${id}${tab ? `/${tab}` : ""}`;

/** Add-on sub navigation (/youtube/…). */
export const ADDON_NAV: { href: string; label: string }[] = [
  { href: BASE, label: "Board" },
  { href: `${BASE}/lab`, label: "Lab" },
  { href: `${BASE}/shots`, label: "Shots backlog" },
  { href: `${BASE}/learning`, label: "Learning" },
  { href: `${BASE}/watchlist`, label: "Watchlist" },
  { href: `${BASE}/weekly`, label: "Weekly" },
  { href: `${BASE}/settings`, label: "Settings" },
];

// ----- Ideation ------------------------------------------------------------------------------------
export const IDEA_STEPS: { id: IdeaStep; label: string; hint: string }[] = [
  { id: "topic", label: "Topic", hint: "Check that the topic can explode: outliers ≥ 3× their channel." },
  { id: "format", label: "Format", hint: "Topic + Format = Base idea. Be remarkable: better or different." },
  { id: "angle", label: "Angle", hint: "The specific way in." },
  { id: "criteria", label: "Criteria", hint: "Gates, view potential and your ratings." },
];
export const IDEA_SOURCES: { id: IdeaSource; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "telegram", label: "Telegram" },
  { id: "note", label: "Note" },
  { id: "comment", label: "Comment" },
  { id: "follow_up", label: "Follow-up" },
  { id: "short_test", label: "Short test" },
  { id: "watchlist", label: "Watchlist" },
];
export const FORMATS: { id: VideoFormat; label: string; hint: string }[] = [
  { id: "tutorial", label: "Tutorial", hint: "Teach how to do something step by step." },
  { id: "challenge", label: "Challenge", hint: "Try something hard with clear stakes." },
  { id: "breakdown", label: "Breakdown", hint: "Explain how/why something works." },
  { id: "commentary", label: "Commentary", hint: "Your take on something happening." },
  { id: "vlog", label: "Vlog", hint: "Follow your life / a journey." },
  { id: "interview", label: "Interview", hint: "Conversation with someone interesting." },
];
export const ANGLES: { id: VideoAngle; label: string; example: string }[] = [
  { id: "superlatives", label: "Superlatives", example: "The best / fastest / cheapest…" },
  { id: "stakes", label: "Stakes", example: "If I fail, I lose…" },
  { id: "money", label: "Money", example: "$1 vs $1000…" },
  { id: "time", label: "Time", example: "In 24 hours / 30 days…" },
  { id: "comprehensive", label: "Comprehensive", example: "Everything you need to know about…" },
  { id: "list", label: "List", example: "7 ways to…" },
  { id: "familiarity", label: "Familiarity", example: "Something everyone knows, seen new" },
  { id: "topic_twist", label: "Topic but twist", example: "X, but with a twist" },
  { id: "comparison", label: "Comparison", example: "A vs B" },
  { id: "transformation", label: "Transformation", example: "From zero to…" },
  { id: "beginner", label: "Beginner", example: "I tried X as a total beginner" },
  { id: "authority", label: "Authority", example: "A teacher explains…" },
  { id: "outcome", label: "Outcome", example: "How I got result X" },
  { id: "mistakes", label: "Mistakes & regrets", example: "Mistakes I made with…" },
  { id: "controversial", label: "Controversial", example: "Why X is wrong" },
];
export const GATES: { id: GateKey; label: string; question: string }[] = [
  { id: "feasibility", label: "Feasibility", question: "Can I actually make this with my time, skills and money?" },
  { id: "brand", label: "Brand alignment", question: "Does it fit my channel and the people I want?" },
  { id: "packageability", label: "Packageability", question: "Is there a quick title + thumbnail idea that makes people click?" },
];
export const RATINGS: { id: RatingKey; label: string; /** effort subtracts */ sign: 1 | -1 }[] = [
  { id: "excitement", label: "Excitement", sign: 1 },
  { id: "confidence", label: "Confidence", sign: 1 },
  { id: "effort", label: "Effort", sign: -1 },
  { id: "new_audience", label: "New audience interest", sign: 1 },
  { id: "existing_audience", label: "Existing audience interest", sign: 1 },
];
export const RATING_MIN = 1;
export const RATING_MAX = 10;
/** Starting weights of the idea score (calibrated later from 7/30-day results, ≥ 10 videos). */
export const DEFAULT_SCORE_WEIGHTS: Record<RatingKey | "view_potential", number> = {
  view_potential: 2,
  excitement: 1,
  confidence: 1,
  effort: 1,
  new_audience: 1,
  existing_audience: 1,
};
/** Below this many own videos "usual" is unreliable → use the view goal; calibration needs CALIBRATION_MIN. */
export const BASELINE_MIN_VIDEOS = 5;
export const CALIBRATION_MIN_VIDEOS = 10;
export const BASELINE_LAST_N = 10;

export const FINDER_DEFAULTS: FinderFilters = { min_views: 100_000, max_subs: 500_000, min_outlier: 3, min_age_days: 14, max_results: 25 };
/** Watchlist: an upload counts as an outlier at ≥ 3× the channel median. Checked once a day (≈ 3 quota units per channel). */
export const WATCH_OUTLIER_MIN = 3;
export const WATCH_CHECK_DAYS = 1;

// ----- Package -------------------------------------------------------------------------------------
export const MAX_TITLES = 3;
export const MAX_THUMBNAILS = 3;
export const PAIR_LABELS = ["A", "B", "C", "D", "E", "F"] as const;
export const GAP_TYPES: { id: GapType; label: string; hint: string }[] = [
  { id: "moment", label: "Moment", hint: "A glimpse of the moment right before a strong reaction." },
  { id: "story", label: "Story", hint: "A tension or question that opens the first act." },
  { id: "result", label: "Result", hint: "Shows a desired result." },
  { id: "transformation", label: "Transformation", hint: "Desired result + the starting state." },
  { id: "novelty", label: "Novelty", hint: "Something we have never seen." },
];
export const SCROLL_STOPPERS: { id: ScrollStopper; label: string }[] = [
  { id: "bright_colors", label: "Bright colors" },
  { id: "big_numbers", label: "Big numbers" },
  { id: "danger_motion", label: "Danger / motion" },
  { id: "aesthetic", label: "Aesthetic" },
  { id: "money", label: "Money" },
  { id: "emotions", label: "Emotions" },
  { id: "faces", label: "Faces" },
];
/** More than this many scroll stoppers dilutes the thumbnail (warning, not a block). */
export const MAX_STOPPERS = 2;
export const CONTRAST_KINDS: { id: ContrastKind; label: string; hint: string }[] = [
  { id: "luminance", label: "Luminance", hint: "Lights vs darks" },
  { id: "saturation", label: "Saturation", hint: "Color vs grey" },
  { id: "hue", label: "Hue", hint: "Complementary colors" },
];
export const COMPOSITIONS = ["Centered", "Rule of thirds"] as const;
export const THUMB_TESTS: { id: ThumbTestKey; label: string; questions: string[] }[] = [
  { id: "clarity", label: "Clarity", questions: ["Readable at sidebar size without squinting?", "Can you read every word?", "Can you identify every element?"] },
  { id: "contrast", label: "Contrast", questions: ["Does it stand out next to others?", "Does it break the pattern?", "Does it stop the scroll?"] },
  { id: "glance", label: "Glance", questions: ["Understood in 2 seconds?", "Do they know what the video is about?", "Can they say what they saw?"] },
  { id: "bonus", label: "Bonus", questions: ["Are there at least 3 variations to swap?"] },
];
/** Title shown in full up to about here on most surfaces (warning only). */
export const TITLE_SOFT_LIMIT = 60;
export const TITLE_CUT_WARNING = 70;
/** Words of the title that must carry the idea. */
export const TITLE_FIRST_WORDS = 4;

// ----- Research ------------------------------------------------------------------------------------
export const DEFAULT_BUCKETS = ["Hook material", "Key points", "Stories & examples", "Data & sources", "Counterpoints", "References"] as const;
export const REFERENCES_BUCKET = "References";
export const CARD_KINDS: { id: "note" | "fragment" | "quick" | "link" | "reference"; label: string }[] = [
  { id: "note", label: "Note" },
  { id: "fragment", label: "Fragment" },
  { id: "quick", label: "Quick card" },
  { id: "link", label: "Link" },
  { id: "reference", label: "Reference" },
];
export const LINK_KINDS: { id: LinkKind; label: string }[] = [
  { id: "series", label: "Series" },
  { id: "follow_up", label: "Follow-up" },
  { id: "watch_next", label: "Watch next" },
];
/** Type property value of notes created from the add-on. */
export const NOTE_TYPES = { research: "Research", script: "Script", postmortem: "Post-mortem", weekly: "YouTube weekly" } as const;

// ----- Outline / script / intro ---------------------------------------------------------------------
export const DEFAULT_WORDS_PER_MIN = 150;
export const INTRO_NUM = 0;
export const CLOSING_NUM = 99;
/** "S00", "S03", "S99" */
export const sectionCode = (num: number | null | undefined) => (num == null ? "S??" : `S${String(num).padStart(2, "0")}`);

const intro = (d = "Meet the title & thumbnail in 5 seconds, then open a loop."): OutlineTemplateSection => ({ kind: "intro", title: "Intro", description: d, energy: 4 });
const closing = (d = "Wrap up and invite them to the next video."): OutlineTemplateSection => ({ kind: "closing", title: "Closing", description: d, energy: 3 });
const body = (title: string, description: string, energy = 3, is_climax = false): OutlineTemplateSection => ({ kind: "body", title, description, energy, is_climax });
/** Built-in outline templates, one per format (editable copies go to yt_outline_templates). */
export const OUTLINE_TEMPLATES: Record<VideoFormat, OutlineTemplateSection[]> = {
  tutorial: [intro(), body("What you'll build / learn", "Show the end result first.", 3), body("Setup", "What you need before starting.", 2), body("Step by step", "The core steps.", 3), body("The tricky part", "Where most people get stuck — the payoff.", 4, true), body("Result & tips", "Final result and extra tips.", 3), closing()],
  challenge: [intro("Show the challenge and the stakes."), body("The rules", "What counts as winning / losing.", 2), body("First attempt", "Start, first problems.", 3), body("Things go wrong", "Rising tension.", 4), body("The final push", "The decisive moment.", 5, true), body("Result", "Did it work? What it cost.", 3), closing()],
  breakdown: [intro("The question everyone has."), body("Context", "What the viewer needs to know.", 2), body("How it works", "The mechanism, piece by piece.", 3), body("The surprising part", "The insight that answers the question.", 4, true), body("What it means for you", "Takeaways.", 3), closing()],
  commentary: [intro("The claim / what happened."), body("What happened", "The facts.", 2), body("My take", "Your opinion and why.", 3), body("The strongest counterpoint", "Steelman the other side.", 3), body("The verdict", "Where it all lands.", 4, true), closing()],
  vlog: [intro("Why this day/journey matters."), body("The plan", "What you're trying to do.", 2), body("On the way", "Moments and obstacles.", 3), body("The big moment", "The peak of the story.", 4, true), body("Reflection", "What you learned.", 2), closing()],
  interview: [intro("Who they are and the best moment teaser."), body("Background", "Their story.", 2), body("Main topic", "The core conversation.", 3), body("The best answer", "The most surprising part.", 4, true), body("Rapid questions / advice", "Short practical answers.", 3), closing()],
};
export const INTRO_STATUSES: { id: IntroStatus; label: string }[] = [
  { id: "not_written", label: "Not written" },
  { id: "draft", label: "Draft" },
  { id: "final", label: "Final" },
  { id: "filmed", label: "Filmed" },
];
export const INTRO_WATCH_TARGET = 10;
export const CUE_KINDS: { id: CueKind; label: string; icon: string }[] = [
  { id: "music", label: "Music", icon: "🎵" },
  { id: "sfx", label: "SFX", icon: "🔊" },
  { id: "cut", label: "Cut / pause", icon: "✂️" },
  { id: "zoom", label: "Zoom", icon: "🔍" },
];

// ----- Shots / filming / files ----------------------------------------------------------------------
export const SHOT_KINDS: { id: ShotKind; label: string; folder: string }[] = [
  { id: "AR", label: "Talking head (A-roll)", folder: "01_Footage/A-roll" },
  { id: "BR", label: "B-roll / filmed scene", folder: "01_Footage/B-roll" },
  { id: "SC", label: "Screen recording", folder: "01_Footage/Screen" },
  { id: "GR", label: "Graphics & text", folder: "03_Graphics" },
  { id: "ST", label: "Stock", folder: "01_Footage/B-roll" },
  { id: "PH", label: "Phone", folder: "01_Footage/Phone" },
  { id: "VT", label: "Vertical (Shorts)", folder: "01_Footage/Phone" },
];
export const SHOT_KIND_IDS: ShotKind[] = SHOT_KINDS.map((k) => k.id);
export const FRAMINGS = ["wide", "medium", "close"] as const;
export const MOMENT_KINDS: { id: MomentKind; label: string; icon: string }[] = [
  { id: "funny", label: "Funny", icon: "😂" },
  { id: "fail", label: "Fail", icon: "💥" },
  { id: "reveal", label: "Reveal", icon: "💡" },
  { id: "effort", label: "Effort", icon: "💪" },
  { id: "other", label: "Other", icon: "📝" },
];
/** Folder layout per video, same on the PC and on Drive ("V012 - <short idea name>/…"). */
export const VIDEO_FOLDERS = ["01_Footage/A-roll", "01_Footage/B-roll", "01_Footage/Screen", "01_Footage/Phone", "02_Audio/Music", "02_Audio/SFX", "02_Audio/VO", "03_Graphics", "04_Exports", "05_Project"] as const;
/** File names: only letters, numbers, "_" and "-". e.g. V012_S03-05_BR_T2.mp4 */
export const FILE_NAME_SAFE = /^[A-Za-z0-9_-]+$/;

// ----- Editing / music ------------------------------------------------------------------------------
export const CLIP_LOCATIONS: { id: ClipLocation; label: string }[] = [
  { id: "drive", label: "Google Drive" },
  { id: "pc", label: "PC / external disk" },
  { id: "phone", label: "On the phone" },
  { id: "other", label: "Other" },
];
export const CLIP_STATUSES: { id: ClipStatus; label: string }[] = [
  { id: "missing", label: "Missing" },
  { id: "recorded", label: "Recorded" },
  { id: "imported", label: "Imported" },
  { id: "in_timeline", label: "In timeline" },
];
export const EDIT_PASSES: { id: EditPass; label: string; hint: string }[] = [
  { id: "rough_cut", label: "Rough cut", hint: "Needs a link (Drive or unlisted YouTube) to mark done." },
  { id: "annotation", label: "Script annotation", hint: "Music, SFX, cut and zoom cues on the script." },
  { id: "broll", label: "B-roll on timeline", hint: "Progress = B-roll/screen/graphics clips in timeline." },
  { id: "music", label: "Music", hint: "Tracks used, source/license, section." },
  { id: "visual", label: "Visual edit", hint: "Text, zooms, graphics, color." },
  { id: "sfx", label: "SFX", hint: "From the 🔊 cues of the script." },
];
/** Music Lab energy levels → layers. */
export const ENERGY_LAYERS = ["pad", "pad + bass", "+ arpeggio", "+ soft drums", "+ full drums & melody"] as const;
export const MUSIC_MOODS = ["curious", "tense", "triumphant", "calm"] as const;

// ----- Publishing (YouTube rules) ---------------------------------------------------------------------
export const YT_LIMITS = {
  titleMax: 100,
  descriptionMax: 5000,
  /** all tags together, in characters */
  tagsTotalMax: 500,
  thumbnailMaxBytes: 2 * 1024 * 1024,
  thumbnailWidth: 1280,
  thumbnailHeight: 720,
  /** text shown before "...more" */
  descriptionHookLines: 2,
  shortMaxSeconds: 180,
} as const;
export const CHAPTER_RULES = {
  /** the first chapter starts at 0:00 */
  firstAt: 0,
  minChapters: 3,
  minSeconds: 10,
} as const;
export const PRIVACY_OPTIONS = ["private", "unlisted", "public"] as const;
/** Things the API cannot do: a manual checklist in YouTube Studio. */
export const STUDIO_CHECKLIST: { id: string; label: string }[] = [
  { id: "end_screen", label: "End screen (watch-next video + playlist)" },
  { id: "cards", label: "Cards" },
  { id: "pinned_comment", label: "Pinned comment" },
  { id: "test_compare", label: "Test & compare started (3 title + thumbnail pairs)" },
];
/** Publish blockers (hard gate c): intro Final + Filmed. Everything else is a warning. */
export const PUBLISH_INTRO_REQUIRED: IntroStatus = "filmed";

// ----- Quotas ---------------------------------------------------------------------------------------
export const YT_QUOTA = {
  dailyUnits: 10_000,
  searchCallsPerDay: 100,
  /** units per call */
  cost: {
    search: 100,
    videosList: 1,
    channelsList: 1,
    playlistItemsList: 1,
    commentThreadsList: 1,
    videosUpdate: 50,
    thumbnailsSet: 50,
    playlistItemsInsert: 50,
    captionsInsert: 400,
  },
  /** the quota day resets at midnight Pacific time */
  resetTimezone: "America/Los_Angeles",
} as const;
/** Groq prompts must stay under this many characters. */
export const AI_PROMPT_MAX = 14_000;
/** Unverified Google app ("Testing"): consent expires after about 7 days. */
export const OAUTH_TESTING_DAYS = 7;

// ----- A/B and follow-ups ---------------------------------------------------------------------------
export const CHECKINS: { id: CheckinKind; label: string; hours: number }[] = [
  { id: "48h", label: "48 hours", hours: 48 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
  { id: "90d", label: "90 days", hours: 24 * 90 },
];
export const TEST_VERDICTS = [
  { id: "winner", label: "Winner" },
  { id: "same", label: "Performed the same" },
  { id: "inconclusive", label: "Inconclusive" },
  { id: "no_clear_difference", label: "No clear difference" },
] as const;
/** reminder_log kinds used by the cron (dedupe). */
export const REMINDER_KINDS = { checkin: "ytcheck", weekly: "ytweekly", oauth: "ytoauth", watch: "ytwatch" } as const;

// ----- Shorts ---------------------------------------------------------------------------------------
export const SHORT_ROLES: { id: ShortRole; label: string; hint: string }[] = [
  { id: "teaser", label: "Teaser", hint: "Best moment of the long video, ends on an open loop, Related video → long." },
  { id: "standalone", label: "Standalone value", hint: "A complete tip on its own. Goal: subscribers." },
  { id: "test", label: "Test", hint: "Try a topic/hook before a long video. ≥ 2× the Shorts median → back to the bank with a bonus." },
];
export const SHORT_TEST_MULTIPLIER = 2;
/** Suggested days after the long video. */
export const SHORT_SCHEDULE_DAYS = { teaser1: 2, teaser2: 5 } as const;
export const SHORT_SECTIONS: OutlineTemplateSection[] = [
  { kind: "intro", title: "Hook", description: "First 1–2 s, with on-screen text." },
  { kind: "body", title: "Body", description: "The one thing." },
  { kind: "closing", title: "Payoff / loop", description: "Pay off, or loop back to the start." },
];

// ----- Settings defaults ----------------------------------------------------------------------------
export const DEFAULT_WIP_LIMIT = 3;
export const DEFAULT_WEEKLY: WeeklyReviewPrefs = { day: 0, time: "18:00", telegram: true, note: true };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MUSIC_STYLES = ["lo-fi", "ambient", "soft electronic", "acoustic", "cinematic-lite"] as const;

/** Short label of a video for headers and lists: "V012 · idea name" (bank ideas have no code yet). */
export function videoLabel(v: { code: string | null; idea_name: string }) {
  return v.code ? `${v.code} · ${v.idea_name}` : v.idea_name;
}

/** Reads a channel link: https://www.youtube.com/@name, /channel/UC…, /c/name, /user/name, or just "@name". null = not a channel link. */
export function parseChannelUrl(input: string): { url: string; handle: string | null; channelId: string | null } | null {
  const raw = input.trim();
  if (!raw) return null;
  const at = /^@([\w.-]{3,100})$/.exec(raw);
  if (at) return { url: `https://www.youtube.com/@${at[1]}`, handle: `@${at[1]}`, channelId: null };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@") && parts[0].length > 1) {
    const h = decodeURIComponent(parts[0]);
    return { url: `https://www.youtube.com/${h}`, handle: h, channelId: null };
  }
  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) return { url: `https://www.youtube.com/channel/${parts[1]}`, handle: null, channelId: parts[1] };
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return { url: `https://www.youtube.com/${parts[0]}/${parts[1]}`, handle: null, channelId: null };
  return null;
}
