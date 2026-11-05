// YouTube add-on — energy curve of a video (pure; Worker B). Used by the Music Lab and the outline.
// Default shape (files-and-music spec): intro high → context low → rises to the climax → closing medium.
// Times: the section's start_s (set by hand after the rough cut) when present, else words ÷ words-per-minute.
import { estimateSeconds } from "@/lib/youtube/outline";
import type { SectionKind } from "@/lib/youtube/types";

export type EnergySection = { id: string; kind: SectionKind; title: string; words: number; energy?: number | null; start_s?: number | null; is_climax?: boolean; code?: string };
export type EnergyCue = { section_id: string; energy: number | null; at_s?: number | null };
export type EnergySegment = { start_s: number; end_s: number; energy: number; label: string; sectionId: string | null };

/** Shortest time a section gets on the curve (an empty section still gets some music). */
export const MIN_SECTION_S = 8;

const clamp = (e: number) => Math.min(5, Math.max(1, Math.round(e)));

/**
 * The energy of every section: its own value when set, else the default shape —
 * intro 4, body rising from 2 to 4 before the climax, climax 5, 3 after it, closing 3.
 */
export function defaultEnergies(sections: EnergySection[]): number[] {
  const climax = sections.findIndex((s) => s.is_climax);
  const bodyIdx = sections.map((s, i) => (s.kind === "body" ? i : -1)).filter((i) => i >= 0);
  const peak = climax >= 0 ? climax : bodyIdx.length ? bodyIdx[Math.floor((bodyIdx.length * 2) / 3)] : -1;
  const before = bodyIdx.filter((i) => i < peak);
  return sections.map((s, i) => {
    if (s.energy != null && Number.isFinite(Number(s.energy))) return clamp(Number(s.energy));
    if (s.kind === "intro") return 4;
    if (s.kind === "closing") return 3;
    if (i === peak) return 5;
    if (i > peak) return 3;
    const k = before.indexOf(i);
    if (before.length <= 1) return 2;
    return clamp(2 + (2 * k) / (before.length - 1));
  });
}

/** Start/end of each section in seconds (start_s when it grows in order, else estimated from words). */
export function sectionTimes(sections: EnergySection[], wpm: number): { start_s: number; end_s: number }[] {
  const est = sections.map((s) => Math.max(MIN_SECTION_S, estimateSeconds(s.words || 0, wpm)));
  const out: { start_s: number; end_s: number }[] = [];
  let t = 0;
  for (let i = 0; i < sections.length; i++) {
    const given = sections[i].start_s;
    const start = i === 0 ? 0 : given != null && given > t - 0.001 ? given : t;
    out.push({ start_s: start, end_s: start + est[i] });
    t = start + est[i];
  }
  // a known later start ends the previous section
  for (let i = 0; i < out.length - 1; i++) if (sections[i + 1].start_s != null && out[i + 1].start_s > out[i].start_s) out[i].end_s = out[i + 1].start_s;
  return out;
}

/**
 * The energy curve: one segment per section, split where a 🎵 music cue with an energy sits (at its at_s
 * when given, else from the start of its section).
 */
export function energyCurve(sections: EnergySection[], wpm: number, cues: EnergyCue[] = []): EnergySegment[] {
  const energies = defaultEnergies(sections);
  const times = sectionTimes(sections, wpm);
  const segs: EnergySegment[] = [];
  sections.forEach((s, i) => {
    const { start_s, end_s } = times[i];
    const mine = cues
      .filter((c) => c.section_id === s.id && c.energy != null)
      .map((c) => ({ at: c.at_s != null && c.at_s > start_s && c.at_s < end_s ? c.at_s : start_s, energy: clamp(Number(c.energy)) }))
      .sort((a, b) => a.at - b.at);
    let cur = start_s;
    let e = energies[i];
    const label = s.code ? `${s.code} · ${s.title}` : s.title;
    for (const c of mine) {
      if (c.at > cur) segs.push({ start_s: cur, end_s: c.at, energy: e, label, sectionId: s.id });
      cur = Math.max(cur, c.at);
      e = c.energy;
    }
    if (end_s > cur) segs.push({ start_s: cur, end_s, energy: e, label, sectionId: s.id });
  });
  return mergeSegments(segs);
}

/** Joins neighbours with the same energy and section. */
export function mergeSegments(segs: EnergySegment[]): EnergySegment[] {
  const out: EnergySegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.energy === s.energy && last.sectionId === s.sectionId && Math.abs(last.end_s - s.start_s) < 0.001) last.end_s = s.end_s;
    else out.push({ ...s });
  }
  return out;
}

/** Energy at time t (the last segment's value after the end; 3 when empty). */
export function energyAt(curve: { start_s: number; energy: number }[], t: number): number {
  let e = curve.length ? curve[0].energy : 3;
  for (const s of curve) if (s.start_s <= t + 1e-9) e = s.energy;
  return e;
}

/** A part of the curve, moved to start at 0 (for one section's track). */
export function sliceCurve(curve: EnergySegment[], from: number, to: number): EnergySegment[] {
  return curve
    .filter((s) => s.end_s > from && s.start_s < to)
    .map((s) => ({ ...s, start_s: Math.max(s.start_s, from) - from, end_s: Math.min(s.end_s, to) - from }));
}

/** Energy of each bar (value at the middle of the bar). */
export function barEnergies(curve: { start_s: number; energy: number }[], bars: number, barSeconds: number): number[] {
  return Array.from({ length: Math.max(0, bars) }, (_, b) => energyAt(curve, (b + 0.5) * barSeconds));
}

export const curveDuration = (curve: { end_s: number }[]) => (curve.length ? curve[curve.length - 1].end_s : 0);
