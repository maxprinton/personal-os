// YouTube add-on — chapters from the outline (pure; Worker B, used by Worker C's publish page).
// YouTube rules (CHAPTER_RULES): the first chapter starts at 0:00, at least 3 chapters, each ≥ 10 seconds,
// timestamps in ascending order, written in the description as "0:00 Title" lines.
import { CHAPTER_RULES } from "@/lib/youtube/constants";
import type { Chapter, SectionKind } from "@/lib/youtube/types";
import { estimateSeconds, sectionWords } from "@/lib/youtube/outline";

export type ChapterSection = { title: string; start_s: number | null | undefined; kind?: SectionKind };

/** 0:00 · 4:05 · 1:02:03 (YouTube style). */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1:02:03" / "4:05" / "75" → seconds; null when it is not a time. */
export function parseTimestamp(text: string): number | null {
  const t = String(text ?? "").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [h, mm, ss] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (ss > 59 || (m[1] != null && mm > 59)) return null;
  return h * 3600 + mm * 60 + ss;
}

const cleanTitle = (t: string) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

/**
 * Chapters from the sections in script order. Sections without a start time are skipped (except the first
 * one, which always starts at 0:00). The intro is called "Intro" unless renamed. Chapters closer than
 * minSeconds to the next one are merged into it (titles joined with " / ") so the result follows the rules.
 */
export function chaptersFromSections(sections: ChapterSection[], opts: { durationS?: number | null; minSeconds?: number } = {}): Chapter[] {
  const min = opts.minSeconds ?? CHAPTER_RULES.minSeconds;
  const raw: Chapter[] = [];
  sections.forEach((s, i) => {
    const start = i === 0 ? CHAPTER_RULES.firstAt : s.start_s;
    if (start == null || !Number.isFinite(start) || start < 0) return;
    const title = cleanTitle(s.title) || (s.kind === "intro" ? "Intro" : s.kind === "closing" ? "Outro" : `Part ${i}`);
    raw.push({ start_s: Math.floor(start), title });
  });
  raw.sort((a, b) => a.start_s - b.start_s);
  if (raw.length && raw[0].start_s !== CHAPTER_RULES.firstAt) raw[0] = { ...raw[0], start_s: CHAPTER_RULES.firstAt };
  // drop duplicates of the same second (keep the first title, join the other)
  const uniq: Chapter[] = [];
  for (const c of raw) {
    const last = uniq[uniq.length - 1];
    if (last && last.start_s === c.start_s) last.title = cleanTitle(`${last.title} / ${c.title}`);
    else uniq.push({ ...c });
  }
  // merge too-short chapters into the next one; the last one is checked against the video length
  const out: Chapter[] = [];
  for (let i = 0; i < uniq.length; i++) {
    const c = uniq[i];
    const end = i + 1 < uniq.length ? uniq[i + 1].start_s : opts.durationS ?? Infinity;
    if (end - c.start_s < min && i + 1 < uniq.length) {
      // too short → the next chapter starts here instead (keeps 0:00 for the first)
      uniq[i + 1] = { start_s: c.start_s, title: cleanTitle(`${c.title} / ${uniq[i + 1].title}`) };
      continue;
    }
    if (end - c.start_s < min && out.length) {
      out[out.length - 1].title = cleanTitle(`${out[out.length - 1].title} / ${c.title}`);
      continue;
    }
    out.push(c);
  }
  return out;
}

export type ChapterCheck = { ok: boolean; problems: string[] };
/** Checks the YouTube rules; problems are plain sentences for the page. */
export function validateChapters(chapters: Chapter[], durationS?: number | null): ChapterCheck {
  const problems: string[] = [];
  if (!chapters.length) return { ok: false, problems: ["No chapters yet."] };
  if (chapters[0].start_s !== CHAPTER_RULES.firstAt) problems.push("The first chapter must start at 0:00.");
  if (chapters.length < CHAPTER_RULES.minChapters) problems.push(`YouTube needs at least ${CHAPTER_RULES.minChapters} chapters.`);
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    if (!cleanTitle(c.title)) problems.push(`Chapter ${i + 1} has no title.`);
    const next = i + 1 < chapters.length ? chapters[i + 1].start_s : durationS ?? null;
    if (i + 1 < chapters.length && next! <= c.start_s) problems.push(`Chapter ${i + 2} (${formatTimestamp(chapters[i + 1].start_s)}) must start after chapter ${i + 1}.`);
    else if (next != null && next - c.start_s < CHAPTER_RULES.minSeconds) problems.push(`“${cleanTitle(c.title)}” is shorter than ${CHAPTER_RULES.minSeconds} seconds.`);
  }
  if (durationS != null && chapters.some((c) => c.start_s >= durationS)) problems.push("A chapter starts after the end of the video.");
  return { ok: problems.length === 0, problems };
}

/** The lines for the description: "0:00 Intro\n1:23 Setup …" */
export const chaptersText = (chapters: Chapter[]) => chapters.map((c) => `${formatTimestamp(c.start_s)} ${cleanTitle(c.title)}`).join("\n");

/** Reads "0:00 Intro" lines (also "0:00 - Intro", "(0:00) Intro"); other lines are ignored. */
export function parseChaptersText(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*[([]?((?:\d+:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|·]?\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const s = parseTimestamp(m[1]);
    if (s != null && m[2]) out.push({ start_s: s, title: cleanTitle(m[2]) });
  }
  return out.sort((a, b) => a.start_s - b.start_s);
}

export type VideoChapterSection = { kind: SectionKind; title: string; start_s?: number | null; words?: number | null; content?: string | null };
/**
 * MAIN HELPER for the publish page (Worker C): chapters for a video from its yt_sections IN SCRIPT ORDER
 * (intro → body by position → closing). A section's real start (start_s, set on the Edit page) is used when
 * present; otherwise it is estimated from the words before it at `wpm` (words = section.words, or counted
 * from content). `estimated` = true when at least one start time is a guess → show "check the times".
 * The result follows CHAPTER_RULES (first at 0:00, ≥ 10 s each); run validateChapters() for the ≥ 3 check.
 */
export function chaptersForVideo(
  sections: VideoChapterSection[],
  opts: { wpm?: number | null; durationS?: number | null } = {},
): { chapters: Chapter[]; estimated: boolean; check: ChapterCheck } {
  const wpm = opts.wpm && opts.wpm > 0 ? opts.wpm : 150;
  let clock = 0;
  let estimated = false;
  const rows: ChapterSection[] = sections.map((s, i) => {
    const real = s.start_s != null && Number.isFinite(s.start_s) && s.start_s >= 0 ? Math.floor(s.start_s) : null;
    const start = i === 0 ? 0 : real ?? clock;
    if (i > 0 && real == null) estimated = true;
    const words = s.words != null && s.words >= 0 ? s.words : sectionWords(s.content ?? "");
    clock = start + estimateSeconds(words, wpm);
    return { title: s.title, start_s: start, kind: s.kind };
  });
  const chapters = chaptersFromSections(rows, { durationS: opts.durationS ?? null });
  return { chapters, estimated, check: validateChapters(chapters, opts.durationS ?? null) };
}
