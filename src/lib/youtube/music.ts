// YouTube add-on — Music Lab composer (pure; Worker B). NO AI, no libraries: rules + a seeded random generator.
// Spec: youtube-files-and-music-spec §3. The browser renders the score with Web Audio (components/youtube/music/render.ts);
// this file only decides WHAT plays and WHEN, encodes WAV and mixes stems, so it is fully testable.
//
//  mood → mode + chord progressions · energy 1–5 → layers (1 pad · 2 +bass · 3 +arpeggio · 4 +soft drums · 5 +full drums & melody)
//  same recipe (inputs + seed) → same music, always. Reroll = new seed; locked layers keep their own seed.
import type { SonicIdentity } from "@/lib/youtube/types";

export const LAYERS = ["pad", "bass", "arp", "drums", "lead"] as const;
export type Layer = (typeof LAYERS)[number];
export const LAYER_LABELS: Record<Layer, string> = { pad: "Pad", bass: "Bass", arp: "Arpeggio", drums: "Drums", lead: "Melody" };
/** Lowest energy level at which a layer plays. */
export const LAYER_MIN_ENERGY: Record<Layer, number> = { pad: 1, bass: 2, arp: 3, drums: 4, lead: 5 };

export type MoodId = "curious" | "tense" | "triumphant" | "calm";
type ChordExt = "triad" | "7" | "9" | "sus2" | "sus4";
type Step = [degree: number, ext: ChordExt];
export type Mood = {
  id: MoodId;
  label: string;
  hint: string;
  /** scale steps of the mode */
  mode: number[];
  minor: boolean;
  bpm: [number, number];
  defaultKey: number;
  progressions: Step[][];
  barsPerChord: 1 | 2;
  /** arpeggio notes per beat */
  arpRate: 2 | 4;
  bass: "roots" | "root5" | "pedal8" | "octaves";
  /** 16 steps per bar */
  kick: number[];
  hat: number[];
  kickFull: number[];
  hatFull: number[];
  snare: number[];
  /** pad brightness (low-pass Hz) */
  padCutoff: number;
  tonicExt: ChordExt;
};

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

export const MOODS: Mood[] = [
  {
    id: "curious",
    label: "Curious",
    hint: "Dorian, open chords, light pulse — explaining, exploring.",
    mode: DORIAN,
    minor: true,
    bpm: [84, 100],
    defaultKey: 2,
    progressions: [
      [[0, "7"], [3, "triad"], [0, "7"], [6, "triad"]],
      [[0, "9"], [2, "7"], [3, "triad"], [4, "sus4"]],
      [[0, "7"], [6, "triad"], [5, "7"], [3, "triad"]],
    ],
    barsPerChord: 1,
    arpRate: 2,
    bass: "root5",
    kick: [0, 10],
    hat: [4, 12],
    kickFull: [0, 7, 10],
    hatFull: [0, 2, 4, 6, 8, 10, 12, 14],
    snare: [4, 12],
    padCutoff: 1400,
    tonicExt: "7",
  },
  {
    id: "tense",
    label: "Tense",
    hint: "Minor, pedal bass, suspended chords — stakes, problems, countdowns.",
    mode: AEOLIAN,
    minor: true,
    bpm: [90, 112],
    defaultKey: 9,
    progressions: [
      [[0, "sus2"], [5, "triad"], [0, "sus4"], [6, "triad"]],
      [[0, "triad"], [1, "sus4"], [5, "triad"], [4, "sus4"]],
      [[0, "sus2"], [3, "sus2"], [5, "triad"], [4, "triad"]],
    ],
    barsPerChord: 1,
    arpRate: 4,
    bass: "pedal8",
    kick: [0, 8],
    hat: [2, 6, 10, 14],
    kickFull: [0, 3, 8, 11],
    hatFull: [0, 2, 4, 6, 8, 10, 12, 14],
    snare: [12],
    padCutoff: 1100,
    tonicExt: "sus2",
  },
  {
    id: "triumphant",
    label: "Triumphant",
    hint: "Major I–V–vi–IV, steady drive — results, wins, the climax.",
    mode: IONIAN,
    minor: false,
    bpm: [100, 122],
    defaultKey: 7,
    progressions: [
      [[0, "triad"], [4, "triad"], [5, "triad"], [3, "triad"]],
      [[3, "triad"], [0, "triad"], [4, "triad"], [5, "triad"]],
      [[0, "triad"], [5, "triad"], [3, "triad"], [4, "sus4"]],
    ],
    barsPerChord: 1,
    arpRate: 2,
    bass: "octaves",
    kick: [0, 8],
    hat: [4, 12],
    kickFull: [0, 4, 8, 12],
    hatFull: [2, 6, 10, 14],
    snare: [4, 12],
    padCutoff: 1800,
    tonicExt: "triad",
  },
  {
    id: "calm",
    label: "Calm",
    hint: "Major 7ths and 9ths, slow — reflection, tutorials, outros.",
    mode: LYDIAN,
    minor: false,
    bpm: [68, 86],
    defaultKey: 5,
    progressions: [
      [[0, "7"], [3, "7"], [5, "7"], [4, "sus2"]],
      [[0, "9"], [5, "7"], [1, "7"], [4, "triad"]],
      [[0, "7"], [2, "7"], [3, "9"], [0, "9"]],
    ],
    barsPerChord: 2,
    arpRate: 2,
    bass: "roots",
    kick: [0],
    hat: [8],
    kickFull: [0, 10],
    hatFull: [4, 8, 12],
    snare: [8],
    padCutoff: 1200,
    tonicExt: "9",
  },
];
export const moodById = (id: string | null | undefined): Mood => MOODS.find((m) => m.id === id) ?? MOODS[0];

/** Style tweaks from the channel's sonic identity. */
export const STYLE_TWEAKS: Record<string, { swing: number; padCutoff: number; drums: number; bright: number }> = {
  "lo-fi": { swing: 0.14, padCutoff: 0.75, drums: 0.9, bright: 0.7 },
  ambient: { swing: 0, padCutoff: 0.85, drums: 0.6, bright: 0.85 },
  "soft electronic": { swing: 0.04, padCutoff: 1.1, drums: 1, bright: 1.1 },
  acoustic: { swing: 0.06, padCutoff: 0.9, drums: 0.8, bright: 0.9 },
  "cinematic-lite": { swing: 0, padCutoff: 1, drums: 0.85, bright: 1 },
};
export const styleTweaks = (style: string | null | undefined) => STYLE_TWEAKS[(style ?? "").toLowerCase().trim()] ?? { swing: 0.04, padCutoff: 1, drums: 1, bright: 1 };

// ----- Seeded random ----------------------------------------------------------------------------------
/** mulberry32: tiny, fast, good enough for music. Same seed → same numbers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mixes a seed with a salt (stable per layer). */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31) + 1;
const pick = <T,>(r: () => number, list: T[]) => list[Math.floor(r() * list.length) % list.length];

// ----- Keys --------------------------------------------------------------------------------------------
export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** "D minor" · "Dm" · "F#" · "Bb major" · "re menor" → { pc, minor } (null when unreadable). */
export function parseKey(text: string | null | undefined): { pc: number; minor: boolean | null } | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  const solfa: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
  let m = /^(do|re|mi|fa|sol|la|si)\s*(#|b|sostenido|bemol)?\s*(.*)$/.exec(t);
  let pc: number | null = null;
  let rest = "";
  if (m) {
    pc = solfa[m[1]] + (m[2] === "#" || m[2] === "sostenido" ? 1 : m[2] === "b" || m[2] === "bemol" ? -1 : 0);
    rest = m[3];
  } else {
    m = /^([a-g])\s*(#|♯|b|♭)?\s*(.*)$/.exec(t);
    if (!m) return null;
    pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1] as "c"]! + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0);
    rest = m[3];
  }
  const minor = /^(m\b|m$|min|minor|menor|moll)/.test(rest) ? true : /^(maj|major|mayor|dur)/.test(rest) ? false : null;
  return { pc: ((pc % 12) + 12) % 12, minor };
}
export const keyName = (pc: number, minor: boolean) => `${NOTE_NAMES[((pc % 12) + 12) % 12]} ${minor ? "minor" : "major"}`;

// ----- Recipe ---------------------------------------------------------------------------------------------
export type CurvePoint = { start_s: number; energy: number };
export type MusicRecipe = {
  v: 1;
  mood: MoodId;
  /** tonic pitch class 0–11 */
  key: number;
  bpm: number;
  duration_s: number;
  seed: number;
  /** energy over time (seconds from the start of this track) */
  curve: CurvePoint[];
  ending: "cadence" | "loop";
  layers: Record<Layer, boolean>;
  /** locked layers keep this seed on Reroll; "harmony" keeps the chords */
  locks: Partial<Record<Layer | "harmony", number>>;
  style: string | null;
  /** "full", "S03", "intro"… (file name part) */
  part: string;
  section_id: string | null;
  /** risers, fills, silence before the climax */
  transitions: boolean;
  /** master level 0.2–1 (narration-friendly default 0.6) */
  volume: number;
};

export const MIN_DURATION = 8;
export const MAX_DURATION = 900;
const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Any stored jsonb → a valid recipe (old/missing fields get defaults). */
export function normalizeRecipe(x: unknown): MusicRecipe {
  const r = (x && typeof x === "object" ? x : {}) as Partial<MusicRecipe> & Record<string, unknown>;
  const mood = moodById(r.mood as string);
  const layersIn = (r.layers ?? {}) as Partial<Record<Layer, boolean>>;
  const locksIn = (r.locks ?? {}) as Record<string, unknown>;
  const locks: MusicRecipe["locks"] = {};
  for (const k of [...LAYERS, "harmony"] as const) if (Number.isFinite(Number(locksIn[k])) && locksIn[k] != null) locks[k] = Number(locksIn[k]) >>> 0;
  const duration = clampNum(r.duration_s, MIN_DURATION, MAX_DURATION, 60);
  const curve = (Array.isArray(r.curve) ? r.curve : [])
    .map((c) => ({ start_s: clampNum((c as CurvePoint)?.start_s, 0, MAX_DURATION, 0), energy: Math.round(clampNum((c as CurvePoint)?.energy, 1, 5, 3)) }))
    .sort((a, b) => a.start_s - b.start_s);
  return {
    v: 1,
    mood: mood.id,
    key: Math.round(clampNum(r.key, 0, 11, mood.defaultKey)),
    bpm: Math.round(clampNum(r.bpm, 50, 160, Math.round((mood.bpm[0] + mood.bpm[1]) / 2))),
    duration_s: Math.round(duration * 10) / 10,
    seed: Number.isFinite(Number(r.seed)) && Number(r.seed) > 0 ? Number(r.seed) >>> 0 : 1,
    curve: curve.length ? curve : [{ start_s: 0, energy: 3 }],
    ending: r.ending === "loop" ? "loop" : "cadence",
    layers: Object.fromEntries(LAYERS.map((l) => [l, layersIn[l] !== false])) as Record<Layer, boolean>,
    locks,
    style: typeof r.style === "string" && r.style.trim() ? r.style.trim() : null,
    part: typeof r.part === "string" && r.part.trim() ? r.part.trim().slice(0, 30) : "full",
    section_id: typeof r.section_id === "string" ? r.section_id : null,
    transitions: r.transitions !== false,
    volume: clampNum(r.volume, 0.2, 1, 0.6),
  };
}

/** BPM for a mood inside the channel's range (middle of the overlap, else the channel's middle). */
export function pickBpm(mood: Mood, sonic?: SonicIdentity | null): number {
  const lo = sonic?.bpm_min ?? null;
  const hi = sonic?.bpm_max ?? null;
  const [a, b] = mood.bpm;
  if (lo == null && hi == null) return Math.round((a + b) / 2);
  const L = Math.max(a, lo ?? a);
  const H = Math.min(b, hi ?? b);
  if (L <= H) return Math.round((L + H) / 2);
  return Math.round(((lo ?? hi!) + (hi ?? lo!)) / 2);
}

/** A first recipe from the channel's sonic identity + the video's curve. */
export function defaultRecipe(opts: { sonic?: SonicIdentity | null; mood?: MoodId; duration_s: number; curve?: CurvePoint[]; part?: string; section_id?: string | null; seed?: number }): MusicRecipe {
  const mood = moodById(opts.mood);
  const k = parseKey(opts.sonic?.key);
  return normalizeRecipe({
    mood: mood.id,
    key: k ? k.pc : mood.defaultKey,
    bpm: pickBpm(mood, opts.sonic),
    duration_s: opts.duration_s,
    seed: opts.seed ?? 1,
    curve: opts.curve ?? [{ start_s: 0, energy: 3 }],
    ending: "cadence",
    style: opts.sonic?.style ?? null,
    part: opts.part ?? "full",
    section_id: opts.section_id ?? null,
  });
}

export const harmonySeed = (r: MusicRecipe) => r.locks.harmony ?? r.seed;
export const layerSeed = (r: MusicRecipe, layer: Layer) => r.locks[layer] ?? mixSeed(r.seed, LAYERS.indexOf(layer) + 1);
/** Reroll: a new seed; locked layers (and locked chords) stay as they are. */
export const reroll = (r: MusicRecipe, seed: number): MusicRecipe => ({ ...r, seed: seed >>> 0 || 1 });
/** Lock/unlock one layer (locking a pitched layer also locks the chords, or it would sound different anyway). */
export function setLock(r: MusicRecipe, what: Layer | "harmony", on: boolean): MusicRecipe {
  const locks = { ...r.locks };
  if (on) {
    locks[what] = what === "harmony" ? harmonySeed(r) : layerSeed(r, what);
    if (what !== "harmony" && what !== "drums" && locks.harmony == null) locks.harmony = harmonySeed(r);
  } else delete locks[what];
  return { ...r, locks };
}

// ----- Score ------------------------------------------------------------------------------------------------
export type NoteEv = { t: number; d: number; m: number; v: number };
export type DrumKind = "kick" | "hat" | "snare" | "riser" | "impact";
export type DrumEv = { t: number; k: DrumKind; v: number; d?: number };
export type Score = {
  bpm: number;
  beat: number;
  bar: number;
  bars: number;
  /** music length (bars × bar) */
  music_s: number;
  /** render length (music + release tail for a cadence) */
  length_s: number;
  /** fade-out start (cadence) */
  fadeFrom: number | null;
  barEnergy: number[];
  chords: { bar: number; root: number; voicing: number[]; label: string }[];
  notes: Record<Exclude<Layer, "drums">, NoteEv[]>;
  drums: DrumEv[];
  silences: [number, number][];
  swing: number;
};

const CHORD_STEPS: Record<ChordExt, number[]> = { triad: [0, 2, 4], "7": [0, 2, 4, 6], "9": [0, 2, 4, 6, 8], sus2: [0, 1, 4], sus4: [0, 3, 4] };
/** Pitch classes (relative semitones from the tonic) of a chord built on a mode degree. */
export function chordTones(mode: number[], degree: number, ext: ChordExt): number[] {
  return CHORD_STEPS[ext].map((s) => {
    const d = degree + s;
    return mode[d % 7] + 12 * Math.floor(d / 7);
  });
}
/** Closest voicing to the previous one inside [lo, hi): smooth chord changes (voice leading). */
export function voiceChord(pcs: number[], prev: number[] | null, lo = 55, hi = 74): number[] {
  const center = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  const out = new Set<number>();
  for (const pc of pcs) {
    const p = ((pc % 12) + 12) % 12;
    let best = lo + ((p - lo) % 12 + 12) % 12;
    for (let m = best; m < hi; m += 12) if (Math.abs(m - center) < Math.abs(best - center)) best = m;
    out.add(best);
  }
  return [...out].sort((a, b) => a - b);
}
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function energyAtT(curve: CurvePoint[], t: number) {
  let e = curve.length ? curve[0].energy : 3;
  for (const c of curve) if (c.start_s <= t + 1e-9) e = c.energy;
  return e;
}

/** Decides every note of the track. Deterministic for a given recipe. */
export function buildScore(recipeIn: MusicRecipe): Score {
  const r = normalizeRecipe(recipeIn);
  const mood = moodById(r.mood);
  const tw = styleTweaks(r.style);
  const beat = 60 / r.bpm;
  const bar = beat * 4;
  const hr = rng(harmonySeed(r));
  const progA = pick(hr, mood.progressions);
  const progB = hr() < 0.6 ? pick(hr, mood.progressions) : progA;
  const cycle = progA.length * mood.barsPerChord;
  let bars = Math.max(2, Math.round(r.duration_s / bar));
  if (r.ending === "loop") bars = Math.max(cycle, Math.round(bars / cycle) * cycle);
  else bars = Math.max(2, Math.ceil(r.duration_s / bar - 0.25));
  const music_s = bars * bar;
  const tail = r.ending === "cadence" ? Math.min(4, bar) + 0.5 : 0;
  const barEnergy = Array.from({ length: bars }, (_, b) => energyAtT(r.curve, (b + 0.5) * bar));

  // ---- chords per bar
  const chords: Score["chords"] = [];
  let prev: number[] | null = null;
  for (let b = 0; b < bars; b++) {
    const phrase = Math.floor(b / 8) % 2;
    const prog = phrase ? progB : progA;
    let step = prog[Math.floor(b / mood.barsPerChord) % prog.length];
    if (r.ending === "cadence" && bars >= 3) {
      if (b === bars - 2) step = [4, "sus4"];
      if (b === bars - 1) step = [0, mood.tonicExt];
    }
    const rel = chordTones(mood.mode, step[0], step[1]);
    const voicing = voiceChord(rel.map((x) => x + r.key), prev);
    prev = voicing;
    const root = r.key + mood.mode[step[0] % 7];
    chords.push({ bar: b, root: ((root % 12) + 12) % 12, voicing, label: `${ROMAN[step[0] % 7]}${step[1] === "triad" ? "" : step[1]}` });
  }

  const on = (layer: Layer, b: number) => r.layers[layer] && barEnergy[b] >= LAYER_MIN_ENERGY[layer];
  const notes: Score["notes"] = { pad: [], bass: [], arp: [], lead: [] };
  const drums: DrumEv[] = [];
  const silences: [number, number][] = [];
  const swingAt = (step16: number) => (step16 % 2 === 1 ? tw.swing * (beat / 4) : 0);
  const vel = (e: number, base: number, span = 0.25) => Math.min(1, base + (span * (e - 1)) / 4);

  // ---- transitions: riser before a rise, silence on the last beat before the climax (energy 5), impact on it
  if (r.transitions) {
    for (let b = 0; b < bars - 1; b++) {
      const rise = barEnergy[b + 1] - barEnergy[b];
      if (rise <= 0) continue;
      const t0 = b * bar;
      if (barEnergy[b + 1] === 5) {
        silences.push([t0 + 3 * beat, t0 + bar]);
        drums.push({ t: t0 + 1 * beat, k: "riser", v: 0.5 + 0.1 * rise, d: 2 * beat });
        drums.push({ t: (b + 1) * bar, k: "impact", v: 0.7 });
      } else drums.push({ t: t0 + 2 * beat, k: "riser", v: 0.3 + 0.1 * rise, d: 2 * beat });
    }
  }

  // ---- pad: one chord per change, held
  for (let b = 0; b < bars; b++) {
    if (!on("pad", b)) continue;
    const isChange = b === 0 || b % mood.barsPerChord === 0 || chords[b].label !== chords[b - 1].label || !on("pad", b - 1) || (r.ending === "cadence" && b >= bars - 2);
    if (!isChange) continue;
    let len = 1;
    while (b + len < bars && len < mood.barsPerChord && chords[b + len].label === chords[b].label && on("pad", b + len) && !(r.ending === "cadence" && b + len >= bars - 2)) len++;
    const last = b + len >= bars;
    const d = len * bar + (last ? tail * 0.8 : 0.08);
    for (const m of chords[b].voicing) notes.pad.push({ t: b * bar, d, m, v: vel(barEnergy[b], 0.45, 0.2) });
  }

  // ---- bass
  const br = rng(layerSeed(r, "bass"));
  const walkEvery = br() < 0.5 ? 2 : 4;
  for (let b = 0; b < bars; b++) {
    if (!on("bass", b)) continue;
    const e = barEnergy[b];
    const t0 = b * bar;
    let root = 36 + chords[b].root;
    if (root > 45) root -= 12;
    const tonic = 36 + (((r.key % 12) + 12) % 12) - (36 + r.key % 12 > 45 ? 12 : 0);
    const v = vel(e, 0.6, 0.2);
    const lastBar = r.ending === "cadence" && b === bars - 1;
    if (lastBar) {
      notes.bass.push({ t: t0, d: bar + tail * 0.7, m: root, v });
      continue;
    }
    switch (mood.bass) {
      case "roots":
        if (e >= 4) notes.bass.push({ t: t0, d: 2 * beat * 0.95, m: root, v }, { t: t0 + 2 * beat, d: 2 * beat * 0.95, m: root, v: v * 0.85 });
        else notes.bass.push({ t: t0, d: bar * 0.97, m: root, v });
        break;
      case "root5":
        notes.bass.push({ t: t0, d: beat * 1.5, m: root, v }, { t: t0 + 2 * beat, d: beat * 0.95, m: root + 7, v: v * 0.8 });
        if (e >= 4) notes.bass.push({ t: t0 + 3.5 * beat, d: beat * 0.45, m: root + 12, v: v * 0.7 });
        break;
      case "pedal8":
        for (let i = 0; i < 8; i++) notes.bass.push({ t: t0 + i * (beat / 2) + swingAt(i * 2), d: beat * 0.42, m: e >= 4 && i === 6 ? root : tonic, v: v * (i % 2 ? 0.7 : 1) });
        break;
      case "octaves":
        for (let i = 0; i < 4; i++) notes.bass.push({ t: t0 + i * beat, d: beat * 0.8, m: i % 2 ? root + 12 : root, v: v * (i === 0 ? 1 : 0.8) });
        break;
    }
    // passing note toward the next chord every few bars
    if (b + 1 < bars && b % walkEvery === walkEvery - 1 && chords[b + 1].root !== chords[b].root && mood.bass !== "pedal8") {
      let next = 36 + chords[b + 1].root;
      if (next > 45) next -= 12;
      const pass = next + (next > root ? -1 : 1) * (mood.minor ? 1 : 2);
      notes.bass.push({ t: t0 + 3.5 * beat, d: beat * 0.45, m: pass, v: v * 0.75 });
    }
  }
  // no two bass notes at once: trim overlaps
  notes.bass.sort((a, b) => a.t - b.t);
  notes.bass = notes.bass.filter((n, i, a) => i === 0 || n.t - a[i - 1].t > 0.02);
  for (let i = 0; i < notes.bass.length - 1; i++) {
    const a = notes.bass[i];
    const n = notes.bass[i + 1];
    if (a.t + a.d > n.t) a.d = Math.max(0.01, n.t - a.t - 0.005);
  }

  // ---- arpeggio: a motif per 8-bar phrase, repeated each bar (sounds composed, not random)
  const ar = rng(layerSeed(r, "arp"));
  const motifs: number[][] = [];
  const restsFor: boolean[][] = [];
  const stepsPerBar = 4 * mood.arpRate;
  for (let p = 0; p < Math.ceil(bars / 8) + 1; p++) {
    const kind = pick(ar, ["up", "updown", "down", "broken", "up"]);
    const n = 6;
    const seq: number[] = [];
    for (let i = 0; i < stepsPerBar; i++) {
      if (kind === "up") seq.push(i % n);
      else if (kind === "down") seq.push(n - 1 - (i % n));
      else if (kind === "updown") {
        const k = i % (2 * n - 2);
        seq.push(k < n ? k : 2 * n - 2 - k);
      } else seq.push([0, 2, 1, 3, 2, 4, 3, 5][i % 8]);
    }
    motifs.push(seq);
    restsFor.push(Array.from({ length: stepsPerBar }, (_, i) => i % 4 !== 0 && ar() < 0.18));
  }
  for (let b = 0; b < bars; b++) {
    if (!on("arp", b)) continue;
    const e = barEnergy[b];
    const tones = [...chords[b].voicing.map((m) => m + 12), ...chords[b].voicing.map((m) => m + 24)].filter((m) => m >= 64 && m <= 91).sort((a, c) => a - c);
    if (!tones.length) continue;
    const ph = Math.floor(b / 8);
    const stepLen = beat / mood.arpRate;
    const lastBar = r.ending === "cadence" && b === bars - 1;
    for (let i = 0; i < stepsPerBar; i++) {
      if (lastBar && i >= mood.arpRate * 2) break;
      if (restsFor[ph][i]) continue;
      const m = tones[motifs[ph][i] % tones.length];
      notes.arp.push({ t: b * bar + i * stepLen + (mood.arpRate === 4 ? swingAt(i) : swingAt(i * 2)), d: stepLen * 0.85, m, v: vel(e, 0.32, 0.18) * (i % mood.arpRate === 0 ? 1 : 0.78) });
    }
  }

  // ---- drums: soft at energy 4, full at 5; a fill before an energy rise
  const dr = rng(layerSeed(r, "drums"));
  const ghost = Array.from({ length: 16 }, () => dr() < 0.2);
  for (let b = 0; b < bars; b++) {
    if (!on("drums", b)) continue;
    const e = barEnergy[b];
    const t0 = b * bar;
    const full = e >= 5;
    const lastBar = r.ending === "cadence" && b === bars - 1;
    if (lastBar) {
      drums.push({ t: t0, k: "kick", v: 0.6 * tw.drums });
      continue;
    }
    const s16 = beat / 4;
    const kick = full ? mood.kickFull : mood.kick;
    const hat = full ? mood.hatFull : mood.hat;
    for (const i of kick) drums.push({ t: t0 + i * s16 + swingAt(i), k: "kick", v: (full ? 0.85 : 0.6) * tw.drums });
    for (const i of hat) drums.push({ t: t0 + i * s16 + swingAt(i), k: "hat", v: (full ? 0.45 : 0.32) * tw.drums * (i % 4 === 0 ? 1 : 0.8) });
    if (full) {
      for (const i of mood.snare) drums.push({ t: t0 + i * s16, k: "snare", v: 0.5 * tw.drums });
      ghost.forEach((g, i) => g && !hat.includes(i) && drums.push({ t: t0 + i * s16 + swingAt(i), k: "hat", v: 0.16 * tw.drums }));
    }
    const rises = b + 1 < bars && barEnergy[b + 1] > e;
    if (rises && r.transitions) for (const i of [12, 13, 14, 15]) drums.push({ t: t0 + i * s16, k: "snare", v: (0.25 + 0.07 * (i - 12)) * tw.drums });
  }

  // ---- lead melody (energy 5 only, soft, pentatonic motif with variations)
  const lr = rng(layerSeed(r, "lead"));
  const pent = mood.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const RHYTHMS = [
    [0, 2, 3, 4, 6, 8, 11, 12],
    [0, 3, 4, 6, 8, 10, 12],
    [0, 1, 2, 4, 8, 9, 10, 12],
    [0, 4, 6, 7, 8, 12, 14],
  ];
  const rhythm = pick(lr, RHYTHMS); // steps in 8ths over 2 bars (16 steps)
  const walk: number[] = [];
  let deg = 5 + Math.floor(lr() * 3);
  for (let i = 0; i < rhythm.length; i++) {
    walk.push(deg);
    deg = Math.max(3, Math.min(11, deg + pick(lr, [-2, -1, -1, 1, 1, 2, 0])));
  }
  const pentMidi = (d: number) => 60 + r.key % 12 + pent[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
  for (let b = 0; b < bars; b += 2) {
    if (!on("lead", b)) continue;
    const variant = Math.floor(b / 2) % 4; // A A' A B
    const eighth = beat / 2;
    rhythm.forEach((st, i) => {
      const bb = b + Math.floor(st / 8);
      if (bb >= bars || !on("lead", bb)) return;
      let d = walk[i] + (variant === 1 ? 1 : 0);
      if (variant === 3 && i === rhythm.length - 1) d = 5; // end on the tonic
      let m = pentMidi(d);
      while (m < 69) m += 12;
      while (m > 88) m -= 12;
      const nextSt = i + 1 < rhythm.length ? rhythm[i + 1] : 16;
      notes.lead.push({ t: b * bar + st * eighth, d: Math.max(eighth * 0.8, (nextSt - st) * eighth * 0.9), m, v: 0.42 });
    });
  }

  // ---- silences and the end: drop notes starting in a silence, cut notes running into one, cut at the end (loop)
  const end = r.ending === "loop" ? music_s : music_s + tail;
  const cut = (list: NoteEv[]) =>
    list
      .filter((n) => !silences.some(([a, z]) => n.t >= a - 1e-6 && n.t < z) && n.t < end)
      .map((n) => {
        let d = n.d;
        for (const [a] of silences) if (n.t < a && n.t + d > a) d = a - n.t;
        if (n.t + d > end) d = end - n.t;
        return { ...n, d: Math.max(0.02, d) };
      });
  for (const k of ["pad", "bass", "arp", "lead"] as const) notes[k] = cut(notes[k]).sort((a, b) => a.t - b.t || a.m - b.m);
  const drumsOut = drums
    .filter((d) => d.k === "riser" || d.k === "impact" || !silences.some(([a, z]) => d.t >= a - 1e-6 && d.t < z))
    .filter((d) => d.t < end)
    .sort((a, b) => a.t - b.t);

  return {
    bpm: r.bpm,
    beat,
    bar,
    bars,
    music_s,
    length_s: end,
    fadeFrom: r.ending === "cadence" ? Math.max(0, (bars - 1) * bar) : null,
    barEnergy,
    chords,
    notes,
    drums: drumsOut,
    silences,
    swing: tw.swing,
  };
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ----- Audio helpers (pure) -----------------------------------------------------------------------------
/** Adds stems sample by sample (each stem: one Float32Array per channel; all the same length). */
export function mixStems(stems: Float32Array[][]): Float32Array[] {
  if (!stems.length) return [];
  const chs = Math.max(...stems.map((s) => s.length));
  const len = Math.max(...stems.flatMap((s) => s.map((c) => c.length)));
  const out = Array.from({ length: chs }, () => new Float32Array(len));
  for (const s of stems) for (let c = 0; c < s.length; c++) for (let i = 0; i < s[c].length; i++) out[c][i] += s[c][i];
  return out;
}
export function peakOf(chs: Float32Array[]): number {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i]);
    if (a > p) p = a;
  }
  return p;
}
/** Multiplies every channel in place. */
export function scaleInPlace(chs: Float32Array[], g: number) {
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g;
}

/** 16-bit PCM WAV file (interleaved), ready to download. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const chs = channels.length || 1;
  const len = channels[0]?.length ?? 0;
  const dataBytes = len * chs * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, chs, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * chs * 2, true);
  v.setUint16(32, chs * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** One line describing a recipe (for lists). */
export function recipeSummary(r: MusicRecipe): string {
  const mood = moodById(r.mood);
  return `${mood.label} · ${keyName(r.key, mood.minor)} · ${r.bpm} BPM · ${Math.round(r.duration_s)}s · seed ${r.seed}`;
}
