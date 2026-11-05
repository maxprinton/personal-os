// YouTube add-on (Worker A) — pure logic of the Research Laboratory: note blocks (fragments with a block
// anchor), suggested notes by keywords, ordering, "Used in", lab overview. No I/O: tested in scripts/test-youtube-a.ts.
import { DEFAULT_BUCKETS } from "@/lib/youtube/constants";

// ----- Keywords -------------------------------------------------------------------------------------
const STOP = new Set(
  (
    "a an the and or but of to in on at for with by from is are was were be been it its this that these those i my me you your we our us how what why when who which do does did " +
    "not no yes can will just so as if then than there here about into out up down more most very really get got make made video videos youtube " +
    "el la los las un una unos unas y o de del al en con por para que es son mi mis tu tus se lo le les como mas muy pero sin sobre este esta esto estos estas hay ya"
  ).split(" "),
);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Meaningful words of a text (≥ 3 letters, no stop words), unique, in order. */
export function keywords(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const w of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

export type SuggestNote = { id: string; title: string; text: string; tags?: string[] };

/**
 * Notes that match the video's words. Title hits count 3, tag hits 2, text hits 1 (once per word).
 * Returns the best `limit` with a score > 0, skipping `exclude` ids.
 */
export function suggestNotes<T extends SuggestNote>(notes: T[], terms: string[], opts: { limit?: number; exclude?: Iterable<string> } = {}): (T & { score: number; hits: string[] })[] {
  const ex = new Set(opts.exclude ?? []);
  const ks = terms.map(fold).filter(Boolean);
  if (!ks.length) return [];
  const out: (T & { score: number; hits: string[] })[] = [];
  for (const n of notes) {
    if (ex.has(n.id)) continue;
    const title = fold(n.title);
    const text = fold(n.text);
    const tags = (n.tags ?? []).map(fold);
    let score = 0;
    const hits: string[] = [];
    for (const k of ks) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
      let s = 0;
      if (re.test(title)) s += 3;
      if (tags.some((t) => t === k || t.startsWith(k))) s += 2;
      if (re.test(text)) s += 1;
      if (s) hits.push(k);
      score += s;
    }
    if (score > 0) out.push({ ...n, score, hits });
  }
  return out.sort((a, b) => b.score - a.score || b.hits.length - a.hits.length).slice(0, opts.limit ?? 12);
}

// ----- Note blocks (fragments) ---------------------------------------------------------------------
export type NoteBlock = { index: number; /** first line index in the Markdown */ line: number; text: string; blockId: string | null; heading: boolean };

const SUFFIX = /[ \t]*\{((?:\s*[\w-]+="[^"]*")+)\s*\}[ \t]*$/;

/** Plain text of one Markdown line (no #, >, -, **, links, block suffix). */
export function plainLine(md: string): string {
  return md
    .replace(SUFFIX, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .trim();
}

/**
 * The paragraphs/headings of a note's Markdown that can become a fragment card, with their block
 * anchor ({id="…"} at the end of the line, the editor's "Copy link to block") when they have one.
 * Skips code blocks, tables, images-only lines and empty lines. One line = one block.
 */
export function splitBlocks(md: string): NoteBlock[] {
  const lines = (md ?? "").replace(/\r/g, "").split("\n");
  const out: NoteBlock[] = [];
  let inCode = false;
  lines.forEach((raw, line) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inCode = !inCode;
      return;
    }
    if (inCode || /^\s*\|/.test(raw) || /^\s*(---|\*\*\*|<\/?\w)/.test(raw)) return;
    const text = plainLine(raw);
    if (!text) return;
    const m = SUFFIX.exec(raw);
    const id = m ? /\bid="([\w-]{1,40})"/.exec(m[1])?.[1] ?? null : null;
    out.push({ index: out.length, line, text, blockId: id, heading: /^\s*#{1,6}\s/.test(raw) });
  });
  return out;
}

/**
 * Makes sure the block at `line` has an anchor. Returns the new Markdown and the id (the existing one if
 * it had one). A color suffix {color="red"} is kept: the id is added inside it. null = not a text line.
 */
export function ensureBlockId(md: string, line: number, newId: string): { md: string; id: string } | null {
  const lines = (md ?? "").replace(/\r/g, "").split("\n");
  const raw = lines[line];
  if (raw === undefined || !plainLine(raw)) return null;
  const m = SUFFIX.exec(raw);
  if (m) {
    const have = /\bid="([\w-]{1,40})"/.exec(m[1])?.[1];
    if (have) return { md, id: have };
    lines[line] = `${raw.slice(0, m.index)} {${m[1].trim()} id="${newId}"}`;
  } else {
    lines[line] = `${raw.replace(/\s+$/, "")} {id="${newId}"}`;
  }
  return { md: lines.join("\n"), id: newId };
}

/** The block that best contains a quote (selected text) — exact match first, then most shared words. */
export function findBlockForQuote(md: string, quote: string): NoteBlock | null {
  const q = fold(quote).replace(/\s+/g, " ").trim();
  if (!q) return null;
  const blocks = splitBlocks(md);
  const exact = blocks.find((b) => fold(b.text).replace(/\s+/g, " ").includes(q.slice(0, 200)));
  if (exact) return exact;
  const qk = keywords(quote, 40);
  if (!qk.length) return null;
  let best: NoteBlock | null = null;
  let bestScore = 0;
  for (const b of blocks) {
    const bk = new Set(keywords(b.text, 80));
    const s = qk.filter((k) => bk.has(k)).length / qk.length;
    if (s > bestScore) {
      best = b;
      bestScore = s;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

export const noteHref = (noteId: string, blockId?: string | null) => `/notes/${noteId}${blockId ? `#b-${blockId}` : ""}`;

// ----- Ordering -------------------------------------------------------------------------------------
/** Position for an item dropped between `before` and `after` (either may be missing). */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1;
  if (before == null) return (after as number) - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

/** Moves item `from` to index `to` (a copy). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x);
  return out;
}

/** Default buckets of a new video (References last). */
export function defaultBuckets(): { name: string; position: number }[] {
  return DEFAULT_BUCKETS.map((name, i) => ({ name, position: i + 1 }));
}

/** A bucket name: trimmed, 1–60 chars, unique among `taken` (adds " 2", " 3"…). */
export function bucketName(raw: string, taken: string[]): string | null {
  const base = raw.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!base) return null;
  const used = new Set(taken.map((t) => fold(t)));
  if (!used.has(fold(base))) return base;
  for (let i = 2; i < 100; i++) if (!used.has(fold(`${base} ${i}`))) return `${base} ${i}`;
  return null;
}

// ----- Links ----------------------------------------------------------------------------------------
/** http(s) link (adds https:// when missing), or null. */
export function cleanUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ----- Used in / overview ---------------------------------------------------------------------------
export type CardRef = { note_id: string | null; video_id: string | null; bucket_id: string; kind: string };
export type VideoRef = { id: string; code: string | null; idea_name: string; stage: string };

/** note id → the videos whose buckets use it (shelves don't count as a video). */
export function usedIn(cards: CardRef[], videos: VideoRef[]): Map<string, VideoRef[]> {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const out = new Map<string, VideoRef[]>();
  for (const c of cards) {
    if (!c.note_id || !c.video_id) continue;
    const v = byId.get(c.video_id);
    if (!v) continue;
    const list = out.get(c.note_id) ?? [];
    if (!list.some((x) => x.id === v.id)) list.push(v);
    out.set(c.note_id, list);
  }
  return out;
}

export type LabOverview = {
  perVideo: { video: VideoRef; cards: number; notes: number; byKind: Record<string, number> }[];
  /** notes used by 2+ videos, most shared first */
  shared: { noteId: string; videos: VideoRef[] }[];
  shelfCards: number;
};
export function labOverview(cards: (CardRef & { bucket_is_shelf?: boolean })[], videos: VideoRef[]): LabOverview {
  const per = new Map<string, { cards: number; notes: Set<string>; byKind: Record<string, number> }>();
  let shelfCards = 0;
  for (const c of cards) {
    if (!c.video_id) {
      shelfCards++;
      continue;
    }
    const p = per.get(c.video_id) ?? { cards: 0, notes: new Set<string>(), byKind: {} };
    p.cards++;
    if (c.note_id) p.notes.add(c.note_id);
    p.byKind[c.kind] = (p.byKind[c.kind] ?? 0) + 1;
    per.set(c.video_id, p);
  }
  const perVideo = videos
    .filter((v) => per.has(v.id))
    .map((v) => ({ video: v, cards: per.get(v.id)!.cards, notes: per.get(v.id)!.notes.size, byKind: per.get(v.id)!.byKind }))
    .sort((a, b) => b.cards - a.cards);
  const shared = [...usedIn(cards, videos).entries()]
    .filter(([, vs]) => vs.length > 1)
    .map(([noteId, vs]) => ({ noteId, videos: vs }))
    .sort((a, b) => b.videos.length - a.videos.length);
  return { perVideo, shared, shelfCards };
}

/**
 * Words/tags that come back across several videos (the lab's "recurring topics"). Each item gives the
 * term and how many different videos have it. `texts`: one entry per video (its idea name, topic, tags of
 * its notes…). Only terms in ≥ `min` videos, most frequent first.
 */
export function recurringTerms(perVideo: { videoId: string; text: string; tags?: string[] }[], opts: { min?: number; limit?: number } = {}): { term: string; videos: number; tag: boolean }[] {
  const count = new Map<string, { videos: Set<string>; tag: boolean }>();
  for (const v of perVideo) {
    const seen = new Set<string>();
    for (const t of v.tags ?? []) {
      const k = `#${fold(t).trim()}`;
      if (k.length < 2 || seen.has(k)) continue;
      seen.add(k);
      const c = count.get(k) ?? { videos: new Set<string>(), tag: true };
      c.videos.add(v.videoId);
      count.set(k, c);
    }
    for (const w of keywords(v.text, 40)) {
      if (seen.has(w)) continue;
      seen.add(w);
      const c = count.get(w) ?? { videos: new Set<string>(), tag: false };
      c.videos.add(v.videoId);
      count.set(w, c);
    }
  }
  return [...count.entries()]
    .map(([term, c]) => ({ term: c.tag ? term.slice(1) : term, videos: c.videos.size, tag: c.tag }))
    .filter((x) => x.videos >= (opts.min ?? 2))
    .sort((a, b) => b.videos - a.videos || Number(b.tag) - Number(a.tag) || a.term.localeCompare(b.term))
    .slice(0, opts.limit ?? 20);
}

/** Note filter of the drawer: text search (title + text) and Type / Area option ids and tag names. */
export type DrawerNote = { id: string; title: string; text: string; typeId: string | null; areaId: string | null; tags: string[] };
export function filterDrawerNotes<T extends DrawerNote>(notes: T[], f: { q?: string; type?: string; area?: string; tag?: string }): T[] {
  const words = fold(f.q ?? "").split(/\s+/).filter(Boolean);
  const tag = f.tag ? fold(f.tag) : "";
  return notes.filter((n) => {
    if (f.type && n.typeId !== f.type) return false;
    if (f.area && n.areaId !== f.area) return false;
    if (tag && !n.tags.some((t) => fold(t) === tag)) return false;
    if (!words.length) return true;
    const hay = `${fold(n.title)} ${fold(n.text)}`;
    return words.every((w) => hay.includes(w));
  });
}
