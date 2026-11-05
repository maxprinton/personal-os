// YouTube add-on — outline, script and intro logic (pure; Worker B). Specs: youtube-outline-script-shotlist,
// youtube-intro, youtube-shorts. Safe on server, client and in tests (no imports with side effects).
//
// Rules:
//  · Intro (S00) and Closing (S99) always exist; body sections in between, ordered by `position`.
//  · Exactly one climax (body section) before the script — not required for Shorts (Hook · Body · Payoff).
//  · Locking the outline gives every section a FIXED number (file names use it): intro 0, closing 99, body 1…98.
//  · NO text outside sections: the script is the ordered sum of the sections' Markdown.
//  · Research "Source" blocks are collapsible <details> blocks whose summary starts with SOURCE_MARK; they are
//    never part of the script text (word counts, prompter, export, captions).
import { CLOSING_NUM, INTRO_NUM, OUTLINE_TEMPLATES, SHORT_SECTIONS, sectionCode } from "@/lib/youtube/constants";
import type { OutlineTemplateSection, SectionKind, VideoFormat, YtKind } from "@/lib/youtube/types";

export type OutlineSection = {
  id: string;
  kind: SectionKind;
  num: number | null;
  title: string;
  description?: string | null;
  position: number;
  is_climax: boolean;
  energy?: number | null;
  content?: string;
  start_s?: number | null;
  words?: number;
};

// ----- Templates ------------------------------------------------------------------------------------
/** Sections for a new outline: Shorts → Hook · Body · Payoff; long → the format's template (Tutorial by default). */
export function templateFor(format: string | null | undefined, kind: YtKind = "long"): OutlineTemplateSection[] {
  if (kind === "short") return SHORT_SECTIONS.map((s) => ({ ...s }));
  const t = OUTLINE_TEMPLATES[(format ?? "") as VideoFormat] ?? OUTLINE_TEMPLATES.tutorial;
  return t.map((s) => ({ ...s }));
}

/** Makes any list of template sections valid: exactly one intro first, one closing last, ≤ 1 climax (body). */
export function normalizeTemplate(sections: OutlineTemplateSection[], kind: YtKind = "long"): OutlineTemplateSection[] {
  const clean = (sections ?? []).filter((s) => s && typeof s.title === "string");
  const intro = clean.find((s) => s.kind === "intro") ?? (kind === "short" ? SHORT_SECTIONS[0] : { kind: "intro" as const, title: "Intro" });
  const closing = clean.find((s) => s.kind === "closing") ?? (kind === "short" ? SHORT_SECTIONS[2] : { kind: "closing" as const, title: "Closing" });
  let climaxSeen = false;
  const body = clean
    .filter((s) => s.kind === "body")
    .map((s) => {
      const is_climax = !!s.is_climax && !climaxSeen;
      if (is_climax) climaxSeen = true;
      return { ...s, title: s.title.trim() || "Untitled part", is_climax, energy: clampEnergy(s.energy) ?? undefined };
    });
  return [{ ...intro, is_climax: false }, ...body, { ...closing, is_climax: false }];
}

export function clampEnergy(e: unknown): number | null {
  const n = Number(e);
  return Number.isFinite(n) && e !== null && e !== "" ? Math.min(5, Math.max(1, Math.round(n))) : null;
}

// ----- Order, validation, numbers --------------------------------------------------------------------
const kindRank = (k: SectionKind) => (k === "intro" ? 0 : k === "body" ? 1 : 2);
/** Intro first, closing last, body by position (then number, then title). */
export function orderSections<T extends Pick<OutlineSection, "kind" | "position" | "num">>(sections: T[]): T[] {
  return [...sections].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.position - b.position || (a.num ?? 999) - (b.num ?? 999));
}

export type OutlineCheck = { ok: boolean; errors: string[]; warnings: string[] };
/** Can the outline become a script? Hard rules = errors; soft = warnings. */
export function validateOutline(sections: Pick<OutlineSection, "kind" | "is_climax" | "title">[], kind: YtKind = "long"): OutlineCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const intros = sections.filter((s) => s.kind === "intro").length;
  const closings = sections.filter((s) => s.kind === "closing").length;
  const body = sections.filter((s) => s.kind === "body");
  const climaxes = sections.filter((s) => s.is_climax);
  if (intros !== 1) errors.push(intros ? "Only one intro is allowed." : "The intro is missing.");
  if (closings !== 1) errors.push(closings ? "Only one closing is allowed." : "The closing is missing.");
  if (!body.length) (kind === "short" ? warnings : errors).push("Add at least one part between the intro and the closing.");
  if (kind !== "short") {
    if (climaxes.length === 0) errors.push("Mark exactly one part as the climax.");
    if (climaxes.length > 1) errors.push("Only one part can be the climax.");
    if (climaxes.some((s) => s.kind !== "body")) errors.push("The climax must be one of the parts (not the intro or closing).");
  }
  if (sections.some((s) => !s.title.trim())) warnings.push("Some parts have no title.");
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Fixed numbers for every section: intro 0, closing 99, body keeps the number it already has (never
 * renumbered once locked: file names use it) and new body sections get the next free number 1…98 in order.
 */
export function assignNumbers(sections: Pick<OutlineSection, "id" | "kind" | "num" | "position">[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  const ordered = orderSections(sections);
  for (const s of ordered) {
    if (s.kind === "intro") out[s.id] = INTRO_NUM;
    else if (s.kind === "closing") out[s.id] = CLOSING_NUM;
    else if (s.num != null && s.num > INTRO_NUM && s.num < CLOSING_NUM && !used.has(s.num)) {
      out[s.id] = s.num;
      used.add(s.num);
    }
  }
  let next = 1;
  for (const s of ordered) {
    if (s.kind !== "body" || out[s.id] != null) continue;
    while (used.has(next) && next < CLOSING_NUM) next++;
    if (next >= CLOSING_NUM) break; // more than 98 parts: leave unnumbered
    out[s.id] = next;
    used.add(next);
  }
  return out;
}

/** Display code: the fixed number once locked, else the order (intro S00, closing S99). */
export function displayCode(s: Pick<OutlineSection, "kind" | "num">, orderIndex: number): string {
  if (s.num != null) return sectionCode(s.num);
  if (s.kind === "intro") return sectionCode(INTRO_NUM);
  if (s.kind === "closing") return sectionCode(CLOSING_NUM);
  return sectionCode(orderIndex);
}

/** Moves item `from` → `to` in a list (returns a new list). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

// ----- Sources (research cards inside a section) -----------------------------------------------------
export const SOURCE_MARK = "📎 Source";
export type SourceCard = { title: string; quote?: string | null; text?: string | null; url?: string | null; noteId?: string | null; annotation?: string | null };

const mdEsc = (s: string) => s.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
/** The collapsible "Source" block put in a section for a research card (the user rewrites below it). */
export function sourceBlock(c: SourceCard): string {
  const title = mdEsc((c.title || "Research card").replace(/\s+/g, " ").trim()).slice(0, 140);
  const lines: string[] = [];
  const quote = (c.quote || c.text || "").trim();
  if (quote) lines.push(quote.split(/\n+/).map((l) => `> ${mdEsc(l)}`).join("\n"));
  if (c.annotation?.trim()) lines.push(`*${mdEsc(c.annotation.trim())}*`);
  const links: string[] = [];
  if (c.noteId) links.push(`[Open note](/notes/${c.noteId})`);
  if (c.url && /^https?:\/\//i.test(c.url)) links.push(`[${c.url.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 60)}](${c.url})`);
  if (links.length) lines.push(links.join(" · "));
  if (!lines.length) lines.push("(no text)");
  return `<details color="gray_bg">\n<summary>${SOURCE_MARK}: ${title}</summary>\n\n${lines.join("\n\n")}\n\n</details>`;
}

type Span = { start: number; end: number; summary: string };
/** Top-level <details>…</details> blocks (nesting-aware). */
function detailsSpans(md: string): Span[] {
  const out: Span[] = [];
  const re = /<details\b[^>]*>|<\/details>/gi;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m[0][1] !== "/") {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const end = m.index + m[0].length;
        const block = md.slice(start, end);
        const sm = /<summary>([\s\S]*?)<\/summary>/i.exec(block);
        out.push({ start, end, summary: sm ? sm[1].trim() : "" });
        start = -1;
      }
    }
  }
  return out;
}
export const isSourceSummary = (summary: string) => summary.replace(/^\s+/, "").startsWith(SOURCE_MARK) || /^(📎\s*)?source\b/i.test(summary.trim());

/** The section's Markdown without its Source blocks (what is really said). */
export function stripSources(md: string): string {
  const text = String(md ?? "");
  const spans = detailsSpans(text).filter((s) => isSourceSummary(s.summary));
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start);
    at = s.end;
  }
  out += text.slice(at);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** The Source blocks of a section (title + inner Markdown), for footnotes. */
export function listSources(md: string): { title: string; body: string }[] {
  const text = String(md ?? "");
  return detailsSpans(text)
    .filter((s) => isSourceSummary(s.summary))
    .map((s) => {
      const block = text.slice(s.start, s.end);
      const body = block.replace(/^<details\b[^>]*>\s*/i, "").replace(/<\/details>\s*$/i, "").replace(/<summary>[\s\S]*?<\/summary>/i, "").trim();
      return { title: s.summary.replace(SOURCE_MARK, "").replace(/^[:\s]+/, "").trim(), body };
    });
}

// ----- Plain text, words, duration -------------------------------------------------------------------
/** One line of Markdown → spoken text (no syntax, no block attrs, no links/images markup). */
export function inlinePlain(line: string): string {
  return line
    .replace(/[ \t]*\{(?:\s*[\w-]+="[^"]*")+\s*\}[ \t]*$/, "") // {color="…" id="…"}
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, a, b) => b || a) // [[page]]
    .replace(/<mention-[^>]*>([^<]*)<\/mention-[^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, "") // other inline html
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?!\s)([^*_]+?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export type Paragraph = { idx: number; text: string; hash: string; blockId: string | null };

/**
 * The spoken paragraphs of a section (Source blocks removed): every text paragraph, list item and quote
 * line group is one paragraph; headings, code, tables, rules, media and other html blocks are skipped.
 * A paragraph's editor block id (" {id="k3x9"}") is kept when present.
 */
export function paragraphs(md: string): Paragraph[] {
  const text = stripSources(md).replace(/\r\n?/g, "\n");
  // drop non-source <details> wrappers but keep their inner text
  const lines = text.split("\n");
  const blocks: { text: string; blockId: string | null }[] = [];
  let buf: string[] = [];
  let bufId: string | null = null;
  let fence = false;
  const flush = () => {
    const t = inlinePlain(buf.join(" "));
    if (t) blocks.push({ text: t, blockId: bufId });
    buf = [];
    bufId = null;
  };
  const idOf = (l: string) => /\{[^}]*\bid="([\w-]{1,40})"[^}]*\}\s*$/.exec(l)?.[1] ?? null;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(l)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (!l.trim()) {
      flush();
      continue;
    }
    const t = l.trim();
    if (/^#{1,6}\s/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) || /^\|/.test(t) || /^<\/?(details|summary|columns?|callout|aside|div|table|video|audio|img|figure|iframe|embed|file|pdf|bookmark|toc|button)\b/i.test(t) || /^<\/(details|summary)>/i.test(t)) {
      flush();
      // keep the text of a non-source <summary>…</summary> line out (it is a toggle title)
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(l);
    if (item) {
      flush();
      buf.push(item[4]);
      bufId = idOf(item[4]);
      flush();
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(t);
    const content = quote ? quote[1] : t;
    if (!buf.length) bufId = idOf(content);
    buf.push(content);
  }
  flush();
  return blocks.map((b, idx) => ({ idx, text: b.text, hash: hashText(b.text), blockId: b.blockId }));
}

/** Spoken text of a section (paragraphs joined by blank lines). */
export const scriptPlainText = (md: string) => paragraphs(md).map((p) => p.text).join("\n\n");

export function countWords(text: string): number {
  const m = String(text ?? "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
/** Words of a section's Markdown (Source blocks excluded). */
export const sectionWords = (md: string) => countWords(scriptPlainText(md));

/** Seconds to say `words` at `wpm` words per minute. */
export function estimateSeconds(words: number, wpm: number): number {
  const w = Number.isFinite(wpm) && wpm > 0 ? wpm : 150;
  return Math.round((Math.max(0, words) / w) * 60);
}
/** 0:05 · 2:05 · 1:02:05 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Short stable hash of a paragraph (case/space-insensitive) — FNV-1a 32-bit, 8 hex chars. */
export function hashText(s: string): string {
  const t = String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ----- Shots ↔ paragraphs ------------------------------------------------------------------------------
export type ShotLink = { id: string; section_id: string | null; para_hash: string | null; block_id: string | null; position?: number };
export type SectionParas = { sectionId: string; paragraphs: Paragraph[] };
export type Reconcile = {
  /** paragraphs with no shot yet → create an A-roll shot */
  create: { sectionId: string; paragraph: Paragraph }[];
  /** shots whose paragraph still exists unchanged → script_changed false */
  ok: string[];
  /** shots whose paragraph was edited → script_changed true; `paragraph` = the current text */
  edited: { shotId: string; paragraph: Paragraph }[];
  /** shots whose paragraph is gone → script_changed true */
  removed: string[];
};

/**
 * Compares the shot list with the script. Shots without para_hash (added by hand, AI suggestions not tied
 * to a line) are left alone. Matching per section: same text (hash) → ok; same editor block id but other
 * text → edited; then leftover paragraphs and shots are paired in order → edited; anything left: new
 * paragraphs → create, old shots → removed. Shots are never deleted automatically.
 */
export function reconcileShots(sections: SectionParas[], shots: ShotLink[]): Reconcile {
  const res: Reconcile = { create: [], ok: [], edited: [], removed: [] };
  const known = new Set(sections.map((s) => s.sectionId));
  for (const sec of sections) {
    const mine = shots.filter((s) => s.section_id === sec.sectionId && s.para_hash).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const covered = new Set<number>();
    const used = new Set<string>();
    const byHash = new Map(sec.paragraphs.map((p) => [p.hash, p]));
    for (const s of mine) {
      const p = byHash.get(s.para_hash!);
      if (p) {
        covered.add(p.idx);
        used.add(s.id);
        res.ok.push(s.id);
      }
    }
    for (const s of mine) {
      if (used.has(s.id) || !s.block_id) continue;
      const p = sec.paragraphs.find((x) => x.blockId === s.block_id);
      if (p && !covered.has(p.idx)) {
        covered.add(p.idx);
        used.add(s.id);
        res.edited.push({ shotId: s.id, paragraph: p });
      }
    }
    // pair leftovers in order: group leftover shots by their old paragraph (hash), one group per paragraph
    const leftParas = sec.paragraphs.filter((p) => !covered.has(p.idx));
    const groups: string[][] = [];
    const groupOf = new Map<string, number>();
    for (const s of mine) {
      if (used.has(s.id)) continue;
      const g = groupOf.get(s.para_hash!);
      if (g == null) {
        groupOf.set(s.para_hash!, groups.length);
        groups.push([s.id]);
      } else groups[g].push(s.id);
    }
    const n = Math.min(leftParas.length, groups.length);
    for (let i = 0; i < n; i++) for (const id of groups[i]) res.edited.push({ shotId: id, paragraph: leftParas[i] });
    for (let i = n; i < leftParas.length; i++) res.create.push({ sectionId: sec.sectionId, paragraph: leftParas[i] });
    for (let i = n; i < groups.length; i++) res.removed.push(...groups[i]);
  }
  // shots of sections that no longer exist (or have no section) but were tied to a line
  for (const s of shots) if (s.para_hash && (!s.section_id || !known.has(s.section_id))) res.removed.push(s.id);
  return res;
}

// ----- Full script & export ---------------------------------------------------------------------------
export type ScriptSection = { code: string; title: string; content: string; kind?: SectionKind };
/**
 * The whole script as Markdown: "## S01 · Title" per section + its text (Source blocks removed).
 * sources "footnotes" → a "Sources" list at the end; "omit" → nothing.
 */
export function fullScriptMarkdown(sections: ScriptSection[], opts: { sources?: "omit" | "footnotes"; heading?: string | null } = {}): string {
  const parts: string[] = [];
  if (opts.heading) parts.push(`# ${opts.heading}`);
  const notes: string[] = [];
  for (const s of sections) {
    const body = stripSources(s.content).trim();
    parts.push(`## ${s.code} · ${s.title || "Untitled"}`);
    parts.push(body || "*(empty)*");
    if (opts.sources === "footnotes") for (const src of listSources(s.content)) notes.push(`- **${s.code}** · ${src.title}${src.body ? ` — ${inlinePlain(src.body.replace(/\n+/g, " ")).slice(0, 300)}` : ""}`);
  }
  if (notes.length) parts.push("---", "### Sources", notes.join("\n"));
  return parts.join("\n\n") + "\n";
}

/** "Script · Learn Spanish · 2026-11-04" (+ " (v2)" from the second version). */
export function exportTitle(ideaName: string, date: string, version = 1): string {
  return `Script · ${ideaName.trim() || "Untitled"} · ${date}${version > 1 ? ` (v${version})` : ""}`;
}
export const nextExportVersion = (exports: { version: number }[]) => exports.reduce((m, e) => Math.max(m, e.version || 0), 0) + 1;

// ----- Intro assistant -----------------------------------------------------------------------------------
const STOP = new Set(
  "a an the and or but if of to in on at for with by from as is are was were be been being am i you he she it we they me my your our their this that these those what which who how why when where do does did not no yes so than then there here just very can will would should could have has had into about over under up down out off more most less much many some any all each every one two its it's i'm you're don't can't won't im youre dont cant wont vs y el la los las un una de del en con por para que es son mi tu su".split(" "),
);
/** Important words of a text (lowercase, no stop words, simple plural → singular), numbers included. */
export function keywords(text: string): string[] {
  const words = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[a-z0-9][a-z0-9']*/g) ?? [];
  const out: string[] = [];
  for (let w of words) {
    w = w.replace(/'s$/, "");
    if (STOP.has(w) || (w.length < 3 && !/^\d+$/.test(w))) continue;
    if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
const NUM_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100", thousand: "1000" };
const canon = (w: string) => NUM_WORDS[w] ?? w;

/** First sentence of a text (up to . ! ? or the end of the first paragraph). */
export function firstSentence(text: string): string {
  const t = String(text ?? "").trim().split(/\n\s*\n/)[0] ?? "";
  const m = /^[\s\S]*?[.!?…](?=\s|$)/.exec(t);
  return (m ? m[0] : t).replace(/\s+/g, " ").trim();
}

/** Does the first sentence carry the title's keywords? ok = ≥ 2 shared (or all of them when the title has ≤ 2). */
export function titleMatch(sentence: string, title: string): { ok: boolean; shared: string[]; missing: string[] } {
  const tk = keywords(title).map(canon);
  const sk = new Set(keywords(sentence).map(canon));
  const shared = tk.filter((w) => sk.has(w) || [...sk].some((s) => s.length >= 5 && w.length >= 5 && (s.startsWith(w.slice(0, 5)) || w.startsWith(s.slice(0, 5)))));
  const missing = tk.filter((w) => !shared.includes(w));
  const need = Math.min(2, tk.length);
  return { ok: tk.length > 0 && shared.length >= need, shared, missing };
}

export type IntroShot = { kind: string; para_hash: string | null; duration_s?: number | null };
/** "Without sound" test: intro paragraphs covered only by talking-head shots (or no shot at all). */
export function withoutSoundGaps(introParas: Paragraph[], introShots: IntroShot[]): Paragraph[] {
  return introParas.filter((p) => {
    const kinds = introShots.filter((s) => s.para_hash === p.hash).map((s) => s.kind);
    return !kinds.some((k) => k !== "AR");
  });
}

/** Average seconds per shot: shot.duration_s when set, else the paragraph's estimated time split across its shots. */
export function avgShotSeconds(paras: Paragraph[], shots: IntroShot[], wpm: number): number | null {
  if (!shots.length) return null;
  let total = 0;
  for (const s of shots) {
    if (s.duration_s && s.duration_s > 0) total += s.duration_s;
    else {
      const p = paras.find((x) => x.hash === s.para_hash);
      const n = shots.filter((x) => x.para_hash === s.para_hash).length || 1;
      total += p ? estimateSeconds(countWords(p.text), wpm) / n : 3;
    }
  }
  return Math.round((total / shots.length) * 10) / 10;
}

/** Pace check: the intro should cut faster (shorter shots) than the rest of the video. */
export function paceCheck(introAvg: number | null, restAvg: number | null): { ok: boolean | null; text: string } {
  if (introAvg == null || restAvg == null) return { ok: null, text: "Add shots to the intro and the rest to compare the pace." };
  if (introAvg < restAvg) return { ok: true, text: `Intro shots average ${introAvg}s vs ${restAvg}s in the rest: faster ✓` };
  return { ok: false, text: `Intro shots average ${introAvg}s vs ${restAvg}s in the rest: make the intro faster (more, shorter shots).` };
}

// ----- Sources: add / remove in a section ------------------------------------------------------------
/** Adds a Source block at the end of the section (the user rewrites in their own words below it). */
export function insertSourceBlock(md: string, block: string): string {
  const t = String(md ?? "").replace(/\s+$/, "");
  return t ? `${t}\n\n${block}\n\n` : `${block}\n\n`;
}

/** Removes the Source block(s) whose title is `title` (as shown after "📎 Source: "). */
export function removeSourceBlock(md: string, title: string): string {
  const text = String(md ?? "");
  const want = mdEsc(String(title ?? "").replace(/\s+/g, " ").trim()).slice(0, 140);
  const spans = detailsSpans(text).filter((s) => isSourceSummary(s.summary) && s.summary.replace(SOURCE_MARK, "").replace(/^[:\s]+/, "").trim() === want);
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start);
    at = s.end;
  }
  out += text.slice(at);
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

export type CardLike = {
  kind: string;
  note_id?: string | null;
  quote_text?: string | null;
  url?: string | null;
  preview?: { title?: string; description?: string } | null;
  text?: string | null;
  annotation?: string | null;
};
/** A research card → its Source block data (noteTitle = title of the linked note, when there is one). */
export function cardSource(c: CardLike, noteTitle?: string | null): SourceCard {
  const first = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const title =
    first(noteTitle) || first(c.preview?.title) || first(c.text).slice(0, 80) || first(c.quote_text).slice(0, 80) || first(c.url).replace(/^https?:\/\/(www\.)?/i, "").slice(0, 80) || "Research card";
  return {
    title,
    quote: c.quote_text ?? (c.kind === "link" ? c.preview?.description ?? null : null),
    text: c.text ?? null,
    url: c.url ?? null,
    noteId: c.note_id ?? null,
    annotation: c.annotation ?? null,
  };
}

// ----- Totals -------------------------------------------------------------------------------------------
export type SectionTotal = { id: string; words: number; seconds: number };
/** Words + estimated seconds per section and for the whole script (Source blocks excluded). */
export function scriptTotals(sections: { id: string; content?: string | null }[], wpm: number): { sections: SectionTotal[]; words: number; seconds: number } {
  const rows = sections.map((s) => {
    const words = sectionWords(s.content ?? "");
    return { id: s.id, words, seconds: estimateSeconds(words, wpm) };
  });
  const words = rows.reduce((a, r) => a + r.words, 0);
  return { sections: rows, words, seconds: estimateSeconds(words, wpm) };
}

// ----- Intro report (assistant checks in one place; used on script, film and edit pages) ---------------
export type IntroShotFull = IntroShot & { section_id: string | null; position?: number; matches_thumbnail?: boolean; description?: string | null };
export type IntroReport = {
  firstSentence: string;
  title: ReturnType<typeof titleMatch> | null;
  firstShot: IntroShotFull | null;
  silentGaps: Paragraph[];
  /** intro paragraphs exist but no shots yet → the "without sound" check can't run */
  noShots: boolean;
  pace: ReturnType<typeof paceCheck>;
  words: number;
  seconds: number;
};
export function introReport(opts: {
  introId: string;
  introMd: string;
  title?: string | null;
  shots: IntroShotFull[];
  /** all sections' paragraphs (for the pace of the rest) */
  sections: { id: string; content?: string | null }[];
  wpm: number;
}): IntroReport {
  const paras = paragraphs(opts.introMd);
  const introShots = opts.shots.filter((s) => s.section_id === opts.introId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const restShots = opts.shots.filter((s) => s.section_id && s.section_id !== opts.introId);
  const restParas = opts.sections.filter((s) => s.id !== opts.introId).flatMap((s) => paragraphs(s.content ?? ""));
  const sentence = firstSentence(paras.map((p) => p.text).join("\n\n"));
  const words = countWords(paras.map((p) => p.text).join(" "));
  return {
    firstSentence: sentence,
    title: opts.title?.trim() && sentence ? titleMatch(sentence, opts.title) : null,
    firstShot: introShots[0] ?? null,
    silentGaps: introShots.length ? withoutSoundGaps(paras, introShots) : [],
    noShots: paras.length > 0 && introShots.length === 0,
    pace: paceCheck(avgShotSeconds(paras, introShots, opts.wpm), avgShotSeconds(restParas, restShots, opts.wpm)),
    words,
    seconds: estimateSeconds(words, opts.wpm),
  };
}

export { sectionCode };
