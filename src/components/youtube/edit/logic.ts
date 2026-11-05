// Pure helpers of the Edit tab (Worker B): clips per shot, passes, cuts, review notes, annotated script.
// No server or browser code here (tested by scripts/test-youtube-b.ts).
import { CLIP_STATUSES, sectionCode } from "@/lib/youtube/constants";
import type { ClipLocation, ClipStatus, CueKind, EditPass, ShotKind } from "@/lib/youtube/types";
import { parseTimestamp, formatTimestamp } from "@/lib/youtube/chapters";

export const STATUS_ORDER: ClipStatus[] = CLIP_STATUSES.map((s) => s.id);
export const statusRank = (s: ClipStatus | null | undefined) => (s ? STATUS_ORDER.indexOf(s) : -1);
export const isClipStatus = (s: unknown): s is ClipStatus => typeof s === "string" && (STATUS_ORDER as string[]).includes(s);
export const isClipLocation = (s: unknown): s is ClipLocation => s === "drive" || s === "pc" || s === "phone" || s === "other";

/** Shot kinds that count for the "B-roll on timeline" pass. */
export const BROLL_KINDS: ShotKind[] = ["BR", "SC", "GR"];
/** Kinds of extra clips (outside the shot list). */
export const EXTRA_KINDS = [
  { id: "stock", label: "Stock footage" },
  { id: "screen", label: "Screen recording" },
  { id: "image", label: "Image" },
  { id: "meme", label: "Meme / GIF" },
  { id: "other", label: "Other" },
] as const;

/** "2:13" · "1:02:03" · "75" · "75s" · "1m 5s" → seconds (null when not a time). */
export function parseClock(text: string | null | undefined): number | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  const ms = /^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/.exec(t);
  if (ms && (ms[1] || ms[2])) return Math.round(Number(ms[1] ?? 0) * 60 + Number(ms[2] ?? 0));
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  return parseTimestamp(t);
}
export const clock = (s: number | null | undefined) => (s == null || !Number.isFinite(s) ? "" : formatTimestamp(s));

export type ClipLike = { shot_id: string | null; status: ClipStatus; location: ClipLocation; take: number; is_best: boolean; file_name?: string };
export type ShotLike = { id: string; kind: ShotKind; done?: boolean };

/** The furthest status a shot has reached across its clips ("missing" with no clips). */
export function shotStatus(shotId: string, clips: ClipLike[]): ClipStatus {
  let best: ClipStatus = "missing";
  for (const c of clips) if (c.shot_id === shotId && statusRank(c.status) > statusRank(best)) best = c.status;
  return best;
}

/** Highest take registered per shot (for the next take number and for ingest). */
export function takesByShot(clips: ClipLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of clips) if (c.shot_id) out[c.shot_id] = Math.max(out[c.shot_id] ?? 0, c.take || 1);
  return out;
}

/** "B-roll on timeline" progress: B-roll/screen/graphics shots with a clip in the timeline / all of them. */
export function brollProgress(shots: ShotLike[], clips: ClipLike[]): { done: number; total: number } {
  const list = shots.filter((s) => BROLL_KINDS.includes(s.kind));
  return { done: list.filter((s) => shotStatus(s.id, clips) === "in_timeline").length, total: list.length };
}

/** Collection progress: shots with at least one clip recorded or further. */
export function collectProgress(shots: ShotLike[], clips: ClipLike[]): { done: number; total: number } {
  return { done: shots.filter((s) => statusRank(shotStatus(s.id, clips)) >= 1).length, total: shots.length };
}

/** Clips that still live only on the phone (not imported yet). */
export const phoneOnly = <T extends ClipLike>(clips: T[]) => clips.filter((c) => c.location === "phone" && statusRank(c.status) < 2);

/** Can a pass be ticked? The rough cut needs a link. */
export function passCheck(pass: EditPass, link: string | null | undefined): string | null {
  if (pass === "rough_cut" && !isLink(link)) return "Add the rough cut link (Drive or unlisted YouTube) first.";
  return null;
}
export const isLink = (s: string | null | undefined) => /^https?:\/\/\S+\.\S+/i.test(String(s ?? "").trim());
export const isFinalCut = (label: string | null | undefined) => /final/i.test(String(label ?? ""));

export type CueLike = { kind: CueKind; section_id: string; block_id: string | null; text?: string | null };
export const sfxCount = (cues: CueLike[]) => cues.filter((c) => c.kind === "sfx").length;
export function cueCounts(cues: CueLike[]): Record<CueKind, number> {
  const out: Record<CueKind, number> = { music: 0, sfx: 0, cut: 0, zoom: 0 };
  for (const c of cues) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

/** Key of a script paragraph for cues: the editor block id, else "h:" + the text hash. */
export const paraKey = (p: { blockId: string | null; hash: string }) => p.blockId ?? `h:${p.hash}`;

export type AnnShot = { id: string; kind: ShotKind; num: number | null; description: string | null; section_id: string | null; para_hash: string | null; block_id: string | null };
export type AnnSection = { id: string; num: number | null; code: string; title: string; paragraphs: { idx: number; hash: string; blockId: string | null; text: string }[] };
export type AnnPara<S, C> = { key: string; text: string; shots: S[]; cues: C[] };
export type AnnBlock<S, C> = { section: AnnSection; paras: AnnPara<S, C>[]; looseShots: S[]; looseCues: C[] };

/**
 * The annotated script: under each paragraph its shots and edit cues. Shots/cues whose line is gone
 * (script changed) are listed at the end of their section ("loose").
 */
export function annotate<S extends AnnShot, C extends CueLike>(sections: AnnSection[], shots: S[], cues: C[]): AnnBlock<S, C>[] {
  return sections.map((sec) => {
    const usedS = new Set<string>();
    const usedC = new Set<C>();
    const paras = sec.paragraphs.map((p) => {
      const key = paraKey(p);
      const ps = shots.filter((s) => s.section_id === sec.id && !usedS.has(s.id) && ((p.blockId && s.block_id === p.blockId) || s.para_hash === p.hash));
      ps.forEach((s) => usedS.add(s.id));
      const pc = cues.filter((c) => c.section_id === sec.id && !usedC.has(c) && (c.block_id === key || (p.blockId != null && c.block_id === `h:${p.hash}`)));
      pc.forEach((c) => usedC.add(c));
      return { key, text: p.text, shots: ps, cues: pc };
    });
    return {
      section: sec,
      paras,
      looseShots: shots.filter((s) => s.section_id === sec.id && !usedS.has(s.id)),
      looseCues: cues.filter((c) => c.section_id === sec.id && !usedC.has(c)),
    };
  });
}

const SHOT_TAG: Record<ShotKind, string> = { AR: "A-ROLL", BR: "B-ROLL", SC: "SCREEN", GR: "TEXT/GRAPHIC", ST: "STOCK", PH: "PHOTO", VT: "VERTICAL" };
/** "[B-ROLL: pouring coffee]" / "[A-ROLL]" */
export function shotLabel(s: { kind: ShotKind; description?: string | null }): string {
  const tag = SHOT_TAG[s.kind] ?? s.kind;
  const d = (s.description ?? "").trim();
  return d && s.kind !== "AR" ? `[${tag}: ${d}]` : `[${tag}]`;
}
const CUE_ICON: Record<CueKind, string> = { music: "🎵 MUSIC", sfx: "🔊 SFX", cut: "✂️ CUT", zoom: "🔍 ZOOM" };
export function cueLabel(c: { kind: CueKind; text?: string | null; mood?: string | null; energy?: number | null; at_s?: number | null }): string {
  const bits = [c.text?.trim(), c.mood ? `mood ${c.mood}` : "", c.energy ? `energy ${c.energy}` : "", c.at_s != null ? `@ ${clock(c.at_s)}` : ""].filter(Boolean);
  return `${CUE_ICON[c.kind]}${bits.length ? ": " + bits.join(" · ") : ""}`;
}

/** Plain-text annotated script (to copy or keep on a second screen). */
export function annotatedText<S extends AnnShot, C extends CueLike & { mood?: string | null; energy?: number | null; at_s?: number | null }>(blocks: AnnBlock<S, C>[], title: string): string {
  const out: string[] = [title, ""];
  for (const b of blocks) {
    out.push(`## ${b.section.code} · ${b.section.title}`, "");
    for (const p of b.paras) {
      out.push(p.text);
      for (const s of p.shots) out.push(`   ${shotLabel(s)}`);
      for (const c of p.cues) out.push(`   ${cueLabel(c)}`);
      out.push("");
    }
    if (b.looseShots.length || b.looseCues.length) {
      out.push("   (lines changed in the script)");
      for (const s of b.looseShots) out.push(`   ${shotLabel(s)}`);
      for (const c of b.looseCues) out.push(`   ${cueLabel(c)}`);
      out.push("");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Printable HTML page of the annotated script (opened in a new window, then Print / Save as PDF). */
export function annotatedHtml<S extends AnnShot, C extends CueLike & { mood?: string | null; energy?: number | null; at_s?: number | null }>(blocks: AnnBlock<S, C>[], title: string): string {
  const body = blocks
    .map((b) => {
      const paras = b.paras
        .map((p) => {
          const notes = [...p.shots.map((s) => `<div class="shot">${esc(shotLabel(s))}</div>`), ...p.cues.map((c) => `<div class="cue">${esc(cueLabel(c))}</div>`)].join("");
          return `<div class="p"><p>${esc(p.text)}</p>${notes}</div>`;
        })
        .join("");
      const loose = [...b.looseShots.map((s) => shotLabel(s)), ...b.looseCues.map((c) => cueLabel(c))];
      return `<h2>${esc(b.section.code)} · ${esc(b.section.title)}</h2>${paras}${loose.length ? `<div class="loose">Lines changed in the script: ${loose.map(esc).join(" ")}</div>` : ""}`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:20px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #ccc}
.p{margin:0 0 10px}.p p{margin:0 0 2px}.shot{font:12px/1.4 ui-monospace,monospace;color:#1d4ed8;margin-left:18px}
.cue{font:12px/1.4 ui-monospace,monospace;color:#b45309;margin-left:18px}.loose{font-size:12px;color:#666}
@media print{body{margin:0}}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}

/** Review notes sorted by time; open ones first when `openFirst`. */
export function sortNotes<T extends { at_seconds: number; resolved: boolean }>(notes: T[], openFirst = false): T[] {
  return [...notes].sort((a, b) => (openFirst && a.resolved !== b.resolved ? (a.resolved ? 1 : -1) : a.at_seconds - b.at_seconds));
}

/** Section codes in order (for selects). */
export const secLabel = (s: { num: number | null; code?: string; title: string }) => `${s.code ?? sectionCode(s.num)} · ${s.title}`;

/** Checks section start times: they must grow in order; returns the problems. */
export function startProblems(starts: (number | null)[]): string[] {
  const out: string[] = [];
  let last = -1;
  starts.forEach((s, i) => {
    if (s == null) return;
    if (i === 0 && s !== 0) out.push("The first part (Intro) should start at 0:00.");
    if (s <= last) out.push(`Part ${i + 1} starts before the part above it.`);
    last = Math.max(last, s);
  });
  return out;
}
