// Music Lab synth (Worker B): renders a Score from @/lib/youtube/music with the browser's own Web Audio
// (OfflineAudioContext) — no samples, no libraries, no AI. One render per layer = stems; the mix is their sum.
// Narration-friendly: a dip around 2 kHz (voice range) on every stem, soft levels, the melody kept quiet.
import { LAYERS, buildScore, midiToHz, mixSeed, moodById, peakOf, rng, scaleInPlace, styleTweaks, type Layer, type MusicRecipe, type Score } from "@/lib/youtube/music";

export const SAMPLE_RATE = 44100;
const STEM_LEVEL: Record<Layer, number> = { pad: 0.9, bass: 0.85, arp: 0.7, drums: 0.75, lead: 0.55 };
const REVERB_SEND: Record<Layer, number> = { pad: 0.35, bass: 0, arp: 0.25, drums: 0.1, lead: 0.3 };

export const hasContent = (score: Score, layer: Layer) => (layer === "drums" ? score.drums.length > 0 : score.notes[layer].length > 0);

function noise(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(seconds * ctx.sampleRate)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return buf;
}
function impulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(mixSeed(seed, c + 7));
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

/** Attack → hold → release on a gain param (times in seconds). */
function env(p: AudioParam, t: number, d: number, a: number, r: number, peak: number) {
  const top = Math.max(0.0002, peak);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(top, t + a);
  p.setValueAtTime(top, Math.max(t + a, t + d));
  p.linearRampToValueAtTime(0, Math.max(t + a, t + d) + r);
}
/** Quick hit that decays exponentially. */
function hit(p: AudioParam, t: number, peak: number, decay: number) {
  p.setValueAtTime(Math.max(0.0002, peak), t);
  p.exponentialRampToValueAtTime(0.0001, t + decay);
}

/** Output chain of one stem: input → (dry + reverb) → voice dip → gate (silences, fades) → destination. */
function bus(ctx: OfflineAudioContext, score: Score, layer: Layer, seed: number) {
  const input = ctx.createGain();
  input.gain.value = STEM_LEVEL[layer];
  const dip = ctx.createBiquadFilter();
  dip.type = "peaking";
  dip.frequency.value = 2200;
  dip.Q.value = 0.9;
  dip.gain.value = layer === "lead" || layer === "arp" ? -6 : -4;
  const gate = ctx.createGain();
  input.connect(dip);
  if (REVERB_SEND[layer] > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.4, seed);
    const wet = ctx.createGain();
    wet.gain.value = REVERB_SEND[layer];
    input.connect(conv).connect(wet).connect(dip);
  }
  dip.connect(gate).connect(ctx.destination);
  const g = gate.gain;
  g.setValueAtTime(0, 0);
  g.linearRampToValueAtTime(1, 0.03);
  for (const [a, b] of score.silences) {
    g.setValueAtTime(1, Math.max(0.04, a - 0.03));
    g.linearRampToValueAtTime(0, a);
    g.setValueAtTime(0, Math.max(a, b - 0.01));
    g.linearRampToValueAtTime(1, b);
  }
  if (score.fadeFrom != null && score.length_s > score.fadeFrom + 0.2) {
    g.setValueAtTime(1, score.fadeFrom);
    g.linearRampToValueAtTime(0, score.length_s - 0.05);
  }
  return input;
}

function schedule(ctx: OfflineAudioContext, score: Score, recipe: MusicRecipe, layer: Layer) {
  const out = bus(ctx, score, layer, recipe.seed);
  const mood = moodById(recipe.mood);
  const tw = styleTweaks(recipe.style);
  const end = score.length_s;
  const ok = (t: number) => t < end - 0.01;

  if (layer === "pad") {
    const cutoff = mood.padCutoff * tw.padCutoff;
    for (const n of score.notes.pad) {
      if (!ok(n.t)) continue;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff;
      f.Q.value = 0.4;
      const g = ctx.createGain();
      const a = Math.min(0.9, n.d / 3);
      env(g.gain, n.t, n.d, a, 1.4, n.v * 0.05);
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiToHz(n.m);
        o.detune.value = det;
        o.connect(f);
        o.start(n.t);
        o.stop(Math.min(end, n.t + n.d + 1.5));
      }
      f.connect(g).connect(out);
    }
  } else if (layer === "bass") {
    for (const n of score.notes.bass) {
      if (!ok(n.t)) continue;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 650;
      const g = ctx.createGain();
      env(g.gain, n.t, n.d, 0.012, 0.12, n.v * 0.3);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = midiToHz(n.m);
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = midiToHz(n.m);
      o.connect(f);
      sub.connect(f);
      f.connect(g).connect(out);
      for (const x of [o, sub]) {
        x.start(n.t);
        x.stop(Math.min(end, n.t + n.d + 0.2));
      }
    }
  } else if (layer === "arp" || layer === "lead") {
    // echo for both
    const beat = score.beat;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, beat * 0.75);
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = layer === "arp" ? 0.22 : 0.18;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(out);
    let lfoGain: GainNode | null = null;
    if (layer === "lead") {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 7;
      lfo.connect(lfoGain);
      lfo.start(0);
      lfo.stop(end);
    }
    const list = score.notes[layer];
    list.forEach((n, i) => {
      if (!ok(n.t)) return;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = (layer === "arp" ? 2600 : 3200) * tw.bright;
      const g = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = layer === "arp" ? (i % 2 ? 0.3 : -0.3) : 0.1;
      if (layer === "arp") {
        g.gain.setValueAtTime(0, n.t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, n.v * 0.12), n.t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, n.t + n.d + 0.25);
      } else env(g.gain, n.t, n.d, 0.03, 0.25, n.v * 0.13);
      const o = ctx.createOscillator();
      o.type = layer === "arp" ? "triangle" : "sine";
      o.frequency.value = midiToHz(n.m);
      if (lfoGain) lfoGain.connect(o.detune);
      o.connect(f);
      if (layer === "lead") {
        const o2 = ctx.createOscillator();
        o2.type = "triangle";
        o2.frequency.value = midiToHz(n.m);
        const g2 = ctx.createGain();
        g2.gain.value = 0.35;
        o2.connect(g2).connect(f);
        o2.start(n.t);
        o2.stop(Math.min(end, n.t + n.d + 0.3));
      }
      f.connect(g).connect(pan);
      pan.connect(out);
      pan.connect(delay);
      o.start(n.t);
      o.stop(Math.min(end, n.t + n.d + 0.3));
    });
  } else {
    const nz = noise(ctx, 2, mixSeed(recipe.seed, 99));
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = Math.min(16000, 9000 * tw.bright);
    top.connect(out);
    const r = rng(mixSeed(recipe.seed, 42));
    const noiseHit = (t: number, dur: number, filter: BiquadFilterType, freq: number, q: number) => {
      const s = ctx.createBufferSource();
      s.buffer = nz;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      s.connect(f).connect(g).connect(top);
      s.start(t, r() * 1.5, Math.min(0.5, dur + 0.05));
      return { g, f, s };
    };
    for (const d of score.drums) {
      if (!ok(d.t)) continue;
      if (d.k === "kick") {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(140, d.t);
        o.frequency.exponentialRampToValueAtTime(45, d.t + 0.12);
        const g = ctx.createGain();
        hit(g.gain, d.t, d.v * 0.9, 0.38);
        o.connect(g).connect(top);
        o.start(d.t);
        o.stop(Math.min(end, d.t + 0.4));
      } else if (d.k === "hat") {
        const { g } = noiseHit(d.t, 0.07, "highpass", 7500, 0.7);
        hit(g.gain, d.t, d.v * 0.22, 0.06);
      } else if (d.k === "snare") {
        const { g } = noiseHit(d.t, 0.2, "bandpass", 1800, 0.8);
        hit(g.gain, d.t, d.v * 0.35, 0.18);
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = 190;
        const g2 = ctx.createGain();
        hit(g2.gain, d.t, d.v * 0.2, 0.1);
        o.connect(g2).connect(top);
        o.start(d.t);
        o.stop(Math.min(end, d.t + 0.12));
      } else if (d.k === "riser") {
        const dur = Math.max(0.3, d.d ?? 1);
        const s = ctx.createBufferSource();
        s.buffer = nz;
        s.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 2;
        f.frequency.setValueAtTime(300, d.t);
        f.frequency.exponentialRampToValueAtTime(6000, d.t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, d.t);
        g.gain.linearRampToValueAtTime(d.v * 0.2, d.t + dur);
        g.gain.linearRampToValueAtTime(0, d.t + dur + 0.03);
        s.connect(f).connect(g).connect(top);
        s.start(d.t);
        s.stop(Math.min(end, d.t + dur + 0.05));
      } else if (d.k === "impact") {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 55;
        const g = ctx.createGain();
        hit(g.gain, d.t, d.v * 0.8, 1.4);
        o.connect(g).connect(top);
        o.start(d.t);
        o.stop(Math.min(end, d.t + 1.5));
        const { g: gn } = noiseHit(d.t, 0.5, "lowpass", 900, 0.5);
        hit(gn.gain, d.t, d.v * 0.4, 0.5);
      }
    }
  }
}

/** One stem (stereo channels) of a recipe, not normalized. */
export async function renderStem(score: Score, recipe: MusicRecipe, layer: Layer, sampleRate = SAMPLE_RATE): Promise<Float32Array[]> {
  const len = Math.max(1, Math.ceil(score.length_s * sampleRate));
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  schedule(ctx, score, recipe, layer);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

export type Render = { score: Score; mix: Float32Array[]; gain: number; layers: Layer[]; sampleRate: number };

/**
 * Renders every audible layer and sums them. The mix peak is set to 0.89 × recipe.volume; `gain` is kept so
 * a stem rendered later lines up with the mix (stems re-render on download to save memory).
 */
export async function renderMix(recipe: MusicRecipe, onProgress?: (done: number, total: number, layer: Layer) => void, sampleRate = SAMPLE_RATE): Promise<Render> {
  const score = buildScore(recipe);
  const layers = LAYERS.filter((l) => hasContent(score, l));
  const len = Math.max(1, Math.ceil(score.length_s * sampleRate));
  const mix = [new Float32Array(len), new Float32Array(len)];
  let i = 0;
  for (const l of layers) {
    onProgress?.(i, layers.length, l);
    const stem = await renderStem(score, recipe, l, sampleRate);
    for (let c = 0; c < 2; c++) {
      const src = stem[c];
      const dst = mix[c];
      for (let k = 0; k < len; k++) dst[k] += src[k] ?? 0;
    }
    i++;
  }
  onProgress?.(layers.length, layers.length, layers[layers.length - 1] ?? "pad");
  const peak = peakOf(mix);
  const gain = peak > 0 ? (0.89 * recipe.volume) / peak : 1;
  scaleInPlace(mix, gain);
  return { score, mix, gain, layers, sampleRate };
}

/** A stem at the same level as in the mix. */
export async function renderStemForMix(r: Render, recipe: MusicRecipe, layer: Layer): Promise<Float32Array[]> {
  const stem = await renderStem(r.score, recipe, layer, r.sampleRate);
  const copy = stem.map((c) => new Float32Array(c));
  scaleInPlace(copy, r.gain);
  return copy;
}
