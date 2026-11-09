// YouTube add-on — Topic + Format = Idea (unique pair) · Idea + Angle = Killer idea.
// Pure helpers (no database): topic keys, the format grid of a topic, and the topic's verdict on YOUR channel.

/** Key used to tell topics apart: lower case, no accents, single spaces. Must match the SQL backfill in 0051. */
export function topicKey(name: string): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** A short topic name from captured text: the first line/sentence, at most 120 characters. */
export function topicNameFrom(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const sentence = t.split(/(?<=[.!?])\s|\n/)[0] ?? t;
  const s = sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}…` : sentence;
  return s.replace(/[.!?]+$/, "");
}

export type TopicIdea = {
  id: string;
  code?: string | null;
  idea_name: string;
  stage: string;
  kind?: string;
  /** main format: the only one that counts for "Topic + Format is used once" */
  format: string | null;
  /** lead angle */
  angle: string | null;
  /** [main, ...mixed-in] and [lead, ...supporting] (mirrors kept by the app) */
  formats?: string[];
  angles?: string[];
  published_at: string | null;
  /** verdict of the 30-day check-in, when it is done */
  verdict30?: string | null;
};

export type FormatState = "free" | "active" | "parked" | "published";
export type FormatCell = { format: string; state: FormatState; ideaId: string | null; label: string | null; verdict: string | null; angle: string | null; mixed: string[]; extraAngles: string[] };

const isPublished = (i: Pick<TopicIdea, "stage" | "published_at">) => i.stage === "published" || !!i.published_at;

/** Long ideas only: Shorts are not part of the Topic × Format rule. */
const longs = (ideas: TopicIdea[]) => ideas.filter((i) => (i.kind ?? "long") === "long");

/** One cell per format: free, in progress, parked, or published (with its verdict). */
export function formatGrid(formats: string[], ideas: TopicIdea[]): FormatCell[] {
  return formats.map((f) => {
    const mine = longs(ideas).filter((i) => i.format === f);
    const live = mine.find((i) => i.stage !== "archived") ?? null;
    const parked = mine.find((i) => i.stage === "archived") ?? null;
    const it = live ?? parked;
    if (!it) return { format: f, state: "free", ideaId: null, label: null, verdict: null, angle: null, mixed: [], extraAngles: [] };
    const state: FormatState = live ? (isPublished(live) ? "published" : "active") : "parked";
    return { format: f, state, ideaId: it.id, label: it.code ? `${it.code} · ${it.idea_name}` : it.idea_name, verdict: it.verdict30 ?? null, angle: it.angle, mixed: extrasOf(it.formats, it.format), extraAngles: extrasOf(it.angles, it.angle) };
  });
}

export const MAX_EXTRAS = 2;

/** The mixed-in formats / supporting angles: everything in the list except the main one (max 2, no duplicates). */
export function extrasOf(list: string[] | null | undefined, main: string | null | undefined): string[] {
  if (!main) return [];
  return [...new Set((list ?? []).filter((x) => x && x !== main))].slice(0, MAX_EXTRAS);
}

/** Cleans the extras typed by the user against the allowed ids: valid, unique, not the main one, at most 2. */
export function cleanExtras(extras: string[] | null | undefined, main: string | null | undefined, allowed: string[]): string[] {
  if (!main) return [];
  return [...new Set((extras ?? []).filter((x) => allowed.includes(x) && x !== main))].slice(0, MAX_EXTRAS);
}

/**
 * An idea of the topic with the SAME mix of formats (same set) but another main format, e.g. "Vlog + Challenge" when
 * "Challenge + Vlog" exists. Not blocked — only a warning. A mix of one format (no extras) never warns.
 */
export function sameMix(ideas: TopicIdea[], main: string | null, extras: string[], exceptId?: string): TopicIdea | null {
  if (!main || !extras.length) return null;
  const key = [main, ...extras].sort().join("+");
  return (
    longs(ideas).find((i) => i.id !== exceptId && i.stage !== "archived" && i.format && i.format !== main && [i.format, ...extrasOf(i.formats, i.format)].sort().join("+") === key) ?? null
  );
}

/** The idea that already uses this topic + format (not counting `exceptId` nor parked ideas), or null. */
export function takenBy(ideas: TopicIdea[], format: string, exceptId?: string): TopicIdea | null {
  return longs(ideas).find((i) => i.format === format && i.stage !== "archived" && i.id !== exceptId) ?? null;
}

/** Formats that are free for this idea (so ✨ only suggests formats you can still use). */
export function freeFormats(formats: string[], ideas: TopicIdea[], exceptId?: string): string[] {
  return formats.filter((f) => !takenBy(ideas, f, exceptId));
}

/** Angles already used by other ideas of the same topic (to avoid repeating them). */
export function usedAngles(ideas: TopicIdea[], exceptId?: string): string[] {
  return [...new Set(longs(ideas).filter((i) => i.id !== exceptId && i.angle).map((i) => i.angle as string))];
}

export type TopicStatus = "untested" | "testing" | "works" | "mixed" | "fails" | "insufficient";
export const MIN_CHANNEL_VIDEOS = 5;

/**
 * The topic's verdict on YOUR channel, from the 30-day check-ins of its published ideas vs the channel's usual views.
 * untested = nothing published · testing = published but no 30-day result yet · insufficient = fewer than 5 videos
 * on the channel (a verdict would be noise) · works = some above and none below · fails = some below and none above ·
 * mixed = anything else.
 */
export function topicStatus(ideas: TopicIdea[], channelVideos: number): TopicStatus {
  const pub = longs(ideas).filter(isPublished);
  if (!pub.length) return "untested";
  const results = pub.map((i) => i.verdict30).filter((v): v is string => v === "above" || v === "normal" || v === "below");
  if (!results.length) return "testing";
  if (channelVideos < MIN_CHANNEL_VIDEOS) return "insufficient";
  const above = results.filter((v) => v === "above").length;
  const below = results.filter((v) => v === "below").length;
  if (above > 0 && below === 0) return "works";
  if (below > 0 && above === 0 && results.every((v) => v === "below")) return "fails";
  return "mixed";
}

export const TOPIC_STATUS_INFO: Record<TopicStatus, { label: string; hint: string }> = {
  untested: { label: "Untested", hint: "No video on this topic has been published on your channel yet." },
  testing: { label: "Testing", hint: "Published, waiting for the 30-day result." },
  works: { label: "Works", hint: "Beat your usual views at 30 days — repeat it with another format." },
  mixed: { label: "Mixed", hint: "Some formats did better than others (or about average)." },
  fails: { label: "Doesn't work", hint: "Below your usual views at 30 days." },
  insufficient: { label: "Not enough data", hint: "Your channel has fewer than 5 videos, so a verdict would be noise." },
};

/** Topics that look like the typed text (for "did you mean…"): same key, or one contains the other. */
export function similarTopics<T extends { name: string }>(topics: T[], text: string, limit = 5): T[] {
  const k = topicKey(text);
  if (k.length < 3) return [];
  return topics
    .map((t) => ({ t, key: topicKey(t.name) }))
    .filter(({ key }) => key === k || key.includes(k) || k.includes(key))
    .sort((a, b) => Number(b.key === k) - Number(a.key === k))
    .slice(0, limit)
    .map((x) => x.t);
}
