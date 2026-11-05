"use client";
// Music Lab (Worker B): background music written by rules, not AI. Inputs: the channel's sonic identity
// (Settings), a mood preset, key, BPM, length, the video's energy curve (outline energy, climax, 🎵 cues,
// section times) and a seed. Energy 1–5 adds layers: pad → bass → arpeggio → soft drums → drums + melody.
// Same recipe + same seed = same music. Renders in the browser (Web Audio), WAV + stems download.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { energyCurve, sliceCurve, type EnergySection } from "@/lib/youtube/energy";
import {
  LAYERS, LAYER_LABELS, LAYER_MIN_ENERGY, MAX_DURATION, MIN_DURATION, MOODS, NOTE_NAMES, buildScore, defaultRecipe, encodeWav, keyName, moodById, newSeed,
  normalizeRecipe, recipeSummary, reroll, setLock, type Layer, type MoodId, type MusicRecipe,
} from "@/lib/youtube/music";
import { musicFileName } from "@/lib/youtube/naming";
import type { SonicIdentity, YtMusic } from "@/lib/youtube/types";
import { BTN, BTN_SM, BOX, Chip, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import { clock } from "@/components/youtube/edit/logic";
import { downloadBlob, useRun } from "@/components/youtube/edit/useRun";
import { deleteLabTrack, saveLabTrack } from "@/app/youtube-actions/music";
import { renderMix, renderStemForMix, type Render } from "./synth";

type Sec = EnergySection & { code: string };
type Cue = { section_id: string; energy: number | null; at_s: number | null; mood: string | null };
type Props = { video: { id: string; code: string | null; idea_name: string }; sections: Sec[]; cues: Cue[]; finalLength: number | null; wpm: number; sonic: SonicIdentity | null; saved: YtMusic[] };

const isMood = (m: unknown): m is MoodId => MOODS.some((x) => x.id === m);
const ENERGY_COLOR = ["", "bg-accent/20", "bg-accent/35", "bg-accent/55", "bg-accent/75", "bg-accent"];

export default function MusicLab({ video, sections, cues, finalLength, wpm, sonic, saved }: Props) {
  // whole-video curve; the final cut's length (when known) stretches the last part
  const curve = useMemo(() => {
    const c = energyCurve(sections, wpm, cues);
    if (finalLength && c.length && finalLength > c[c.length - 1].start_s) c[c.length - 1] = { ...c[c.length - 1], end_s: finalLength };
    return c;
  }, [sections, cues, finalLength, wpm]);
  const total = curve.length ? curve[curve.length - 1].end_s : 60;
  const parts = useMemo(() => {
    const list = [{ id: "full", label: `Whole video (${clock(total)})`, from: 0, to: total, file: "full", section_id: null as string | null }];
    for (const s of sections) {
      const segs = curve.filter((c) => c.sectionId === s.id);
      if (!segs.length) continue;
      const from = segs[0].start_s;
      const to = segs[segs.length - 1].end_s;
      list.push({ id: s.id, label: `${s.code} · ${s.title} (${clock(from)}–${clock(to)})`, from, to, file: s.code || s.kind, section_id: s.id });
    }
    return list;
  }, [curve, sections, total]);

  const recipeFor = (partId: string, seed: number, mood?: MoodId): MusicRecipe => {
    const p = parts.find((x) => x.id === partId) ?? parts[0];
    const cueMood = cues.find((c) => (p.section_id ? c.section_id === p.section_id : true) && isMood(c.mood))?.mood;
    const dur = Math.min(MAX_DURATION, Math.max(MIN_DURATION, p.to - p.from));
    return defaultRecipe({
      sonic,
      mood: mood ?? (isMood(cueMood) ? cueMood : "curious"),
      duration_s: dur,
      curve: sliceCurve(curve, p.from, p.to).map((s) => ({ start_s: Math.round(s.start_s * 10) / 10, energy: s.energy })),
      part: p.file,
      section_id: p.section_id,
      seed,
    });
  };

  const [partId, setPartId] = useState("full");
  const [recipe, setRecipe] = useState<MusicRecipe>(() => recipeFor("full", 1));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [trackName, setTrackName] = useState("");
  const [render, setRender] = useState<Render | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; started: number } | null>(null);
  const { run, pending, error, info } = useRun();

  const key = JSON.stringify(recipe);
  const fresh = !!render && renderedKey === key;
  const mood = moodById(recipe.mood);
  const score = useMemo(() => buildScore(recipe), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const part = parts.find((p) => p.id === partId) ?? parts[0];
  const fileName = musicFileName(video.code, recipe.part);

  const stop = () => {
    try {
      audio.current?.src.stop();
      void audio.current?.ctx.close();
    } catch {}
    audio.current = null;
    setPlaying(false);
  };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const a = audio.current;
      if (a) setPos(a.ctx.currentTime - a.started);
    }, 200);
    return () => clearInterval(id);
  }, [playing]);

  const generate = async (): Promise<Render | null> => {
    setErr(null);
    stop();
    try {
      if (typeof OfflineAudioContext === "undefined") throw new Error("This browser can't make audio. Try Chrome or Edge.");
      const r = await renderMix(recipe, (d, t, l) => setProgress(d < t ? `Rendering ${LAYER_LABELS[l]} (${d + 1}/${t})…` : "Mixing…"));
      setRender(r);
      setRenderedKey(key);
      return r;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not render the music.");
      return null;
    } finally {
      setProgress(null);
    }
  };
  const play = async () => {
    const r = fresh ? render : await generate();
    if (!r) return;
    stop();
    const ctx = new AudioContext({ sampleRate: r.sampleRate });
    const buf = ctx.createBuffer(2, r.mix[0].length, r.sampleRate);
    buf.getChannelData(0).set(r.mix[0]);
    buf.getChannelData(1).set(r.mix[1]);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(false);
    src.start();
    audio.current = { ctx, src, started: ctx.currentTime };
    setPos(0);
    setPlaying(true);
  };
  const wavBlob = (chs: Float32Array[], sr: number) => new Blob([encodeWav(chs, sr).buffer as ArrayBuffer], { type: "audio/wav" });
  const downloadMix = async () => {
    const r = fresh ? render : await generate();
    if (r) downloadBlob(fileName, wavBlob(r.mix, r.sampleRate));
  };
  const downloadStem = async (l: Layer) => {
    const r = fresh ? render : await generate();
    if (!r) return;
    setProgress(`Rendering the ${LAYER_LABELS[l]} stem…`);
    try {
      const stem = await renderStemForMix(r, recipe, l);
      downloadBlob(musicFileName(video.code, recipe.part, l), wavBlob(stem, r.sampleRate));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not render the stem.");
    } finally {
      setProgress(null);
    }
  };

  const change = (patch: Partial<MusicRecipe>) => setRecipe((r) => normalizeRecipe({ ...r, ...patch }));
  const pickPart = (id: string) => {
    setPartId(id);
    setEditingId(null);
    setRecipe((r) => {
      const next = recipeFor(id, r.seed);
      return normalizeRecipe({ ...next, mood: r.mood, key: r.key, bpm: r.bpm, layers: r.layers, locks: r.locks, volume: r.volume, transitions: r.transitions, ending: r.ending });
    });
  };
  const setSegEnergy = (i: number, e: number) => change({ curve: recipe.curve.map((c, k) => (k === i ? { ...c, energy: e } : c)) });
  const load = (m: YtMusic) => {
    const r = normalizeRecipe(m.recipe);
    setRecipe(r);
    setEditingId(m.id);
    setTrackName(m.track);
    setPartId(r.section_id && parts.some((p) => p.id === r.section_id) ? r.section_id : "full");
  };
  const save = (asNew: boolean) =>
    run(async () => {
      const res = await saveLabTrack(video.id, {
        id: asNew ? null : editingId,
        track: trackName.trim() || `${mood.label} · ${recipe.part}`,
        recipe,
        file_name: fileName,
        section_id: recipe.section_id,
        start_s: part.from,
        end_s: part.from + recipe.duration_s,
      });
      if (res.id) setEditingId(res.id);
      return res;
    }, "Recipe saved. It is in Edit → Music too.");

  const curveEnd = recipe.duration_s;
  const sonicLine = [sonic?.style, sonic?.key, sonic?.bpm_min || sonic?.bpm_max ? `${sonic?.bpm_min ?? "?"}–${sonic?.bpm_max ?? "?"} BPM` : "", (sonic?.instruments ?? []).join(", ")].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <div className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">🎛 Music Lab</h2>
          <span className="text-xs text-muted">No AI · your own music · same seed = same track</span>
        </div>
        <p className="text-xs text-muted">
          Sonic identity: {sonicLine || "not set"} ·{" "}
          <Link href="/youtube/settings" className="text-accent underline">
            change in Settings
          </Link>
        </p>
        <label className="block text-xs text-muted">
          What is this track for?
          <select className={INPUT} value={partId} onChange={(e) => pickPart(e.target.value)}>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-faint">Times come from the section start times (Edit → Passes & cuts) when you set them, else from the words ({wpm} words/min).</p>
      </div>

      <div className={BOX}>
        <h3 className="font-semibold">Mood</h3>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <Chip key={m.id} on={recipe.mood === m.id} title={m.hint} onClick={() => change({ mood: m.id })}>
              {m.label}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted">{mood.hint}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Key
            <select className={INPUT} value={recipe.key} onChange={(e) => change({ key: Number(e.target.value) })}>
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {keyName(i, mood.minor)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Tempo: {recipe.bpm} BPM
            <input type="range" min={50} max={160} value={recipe.bpm} onChange={(e) => change({ bpm: Number(e.target.value) })} className="w-full" />
          </label>
          <label className="text-xs text-muted">
            Length (seconds)
            <input type="number" className={INPUT} min={MIN_DURATION} max={MAX_DURATION} value={recipe.duration_s} onChange={(e) => change({ duration_s: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-muted">
            Ending
            <select className={INPUT} value={recipe.ending} onChange={(e) => change({ ending: e.target.value as MusicRecipe["ending"] })}>
              <option value="cadence">Ends (closing chord + fade)</option>
              <option value="loop">Clean loop</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            Level under the voice: {Math.round(recipe.volume * 100)}%
            <input type="range" min={20} max={100} value={Math.round(recipe.volume * 100)} onChange={(e) => change({ volume: Number(e.target.value) / 100 })} className="w-full" />
          </label>
          <label className="flex items-center gap-2 pt-4 text-xs text-muted">
            <input type="checkbox" checked={recipe.transitions} onChange={(e) => change({ transitions: e.target.checked })} /> Transitions (risers, fills, silence before the climax)
          </label>
        </div>
      </div>

      <div className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Energy curve</h3>
          <button type="button" className={BTN_SM} onClick={() => change({ curve: recipeFor(partId, recipe.seed).curve })}>
            Reset to the video&apos;s curve
          </button>
        </div>
        <p className="text-xs text-muted">From the outline (intro high → context low → climax 5 → closing medium) and your 🎵 cues. 1 pad · 2 + bass · 3 + arpeggio · 4 + soft drums · 5 + full drums & melody.</p>
        <div className="flex h-24 items-end gap-px overflow-hidden rounded-md border border-line bg-subtle">
          {recipe.curve.map((c, i) => {
            const end = recipe.curve[i + 1]?.start_s ?? curveEnd;
            const w = Math.max(0, Math.min(curveEnd, end) - c.start_s);
            if (w <= 0) return null;
            return (
              <div key={i} className="flex h-full flex-col justify-end" style={{ flexGrow: w, flexBasis: 0 }} title={`${clock(c.start_s)} · energy ${c.energy}`}>
                <div className={`${ENERGY_COLOR[c.energy]} flex items-start justify-center text-[10px] text-fg`} style={{ height: `${c.energy * 20}%` }}>
                  {c.energy}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {recipe.curve.map((c, i) => (
            <label key={i} className="flex items-center gap-1 text-xs text-muted">
              {clock(c.start_s)}
              <select className="rounded border border-line bg-surface px-1 text-xs" value={c.energy} onChange={(e) => setSegEnergy(i, Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className={BOX}>
        <h3 className="font-semibold">Layers</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {LAYERS.map((l) => {
            const locked = recipe.locks[l] != null;
            return (
              <div key={l} className="flex items-center gap-2 rounded-md border border-line p-2 text-sm">
                <input type="checkbox" aria-label={`Use ${LAYER_LABELS[l]}`} checked={recipe.layers[l]} onChange={(e) => change({ layers: { ...recipe.layers, [l]: e.target.checked } })} />
                <span className="flex-1">
                  {LAYER_LABELS[l]} <span className="text-xs text-faint">from energy {LAYER_MIN_ENERGY[l]}</span>
                </span>
                <button type="button" className={BTN_SM} title={locked ? "Locked: Reroll keeps this layer" : "Lock this layer (Reroll keeps it)"} onClick={() => setRecipe((r) => setLock(r, l, !locked))}>
                  {locked ? "🔒 Locked" : "🔓 Lock"}
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 rounded-md border border-line p-2 text-sm">
            <span className="flex-1">
              Chords <span className="text-xs text-faint">{score.chords.slice(0, 8).map((c) => c.label).join(" · ")}</span>
            </span>
            <button type="button" className={BTN_SM} onClick={() => setRecipe((r) => setLock(r, "harmony", r.locks.harmony == null))}>
              {recipe.locks.harmony != null ? "🔒 Kept" : "🔓 Keep"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={() => setRecipe((r) => reroll(r, newSeed()))}>
            🎲 Reroll
          </button>
          <label className="flex items-center gap-1 text-xs text-muted">
            Seed
            <input type="number" className={`${INPUT} w-32`} value={recipe.seed} onChange={(e) => change({ seed: Number(e.target.value) })} />
          </label>
          <span className="text-xs text-faint">{recipeSummary(recipe)} · {score.bars} bars</span>
        </div>
      </div>

      <div className={BOX}>
        <div className="flex flex-wrap items-center gap-2">
          {playing ? (
            <button type="button" className={PRIMARY} onClick={stop}>
              ■ Stop
            </button>
          ) : (
            <button type="button" className={PRIMARY} disabled={!!progress} onClick={play}>
              ▶ {fresh ? "Play" : "Generate & play"}
            </button>
          )}
          {playing && (
            <span className="font-mono text-xs text-muted">
              {clock(pos)} / {clock(render?.score.length_s ?? 0)}
            </span>
          )}
          <button type="button" className={BTN} disabled={!!progress} onClick={downloadMix}>
            ⬇ WAV
          </button>
          <span className="text-xs text-faint">{fileName}</span>
          {progress && <span className="text-xs text-muted">{progress}</span>}
        </div>
        {render && !fresh && <p className="text-xs text-warning">Settings changed — press Generate & play to hear the new version.</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Stems for DaVinci:
          {LAYERS.filter((l) => (l === "drums" ? score.drums.length : score.notes[l].length)).map((l) => (
            <button key={l} type="button" className={BTN_SM} disabled={!!progress} onClick={() => downloadStem(l)}>
              ⬇ {LAYER_LABELS[l]}
            </button>
          ))}
        </div>
        <Msg error={err} />
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="min-w-[12rem] flex-1 text-xs text-muted">
            Track name
            <input className={INPUT} value={trackName} placeholder={`${mood.label} · ${recipe.part}`} onChange={(e) => setTrackName(e.target.value)} />
          </label>
          {editingId && (
            <button type="button" className={BTN} disabled={pending} onClick={() => save(false)}>
              Update saved recipe
            </button>
          )}
          <button type="button" className={editingId ? BTN : PRIMARY} disabled={pending} onClick={() => save(true)}>
            Save recipe as new track
          </button>
        </div>
        <Msg error={error} info={info} />
        <p className="text-xs text-faint">The recipe (all settings + seed) is saved, not the audio. Download the WAV and put it in 02_Audio/Music.</p>
      </div>

      <div className={BOX}>
        <h3 className="font-semibold">Saved tracks</h3>
        {!saved.length && <p className="text-sm text-muted">None yet.</p>}
        {saved.map((m) => {
          const r = normalizeRecipe(m.recipe);
          return (
            <div key={m.id} className={`flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm ${editingId === m.id ? "border-accent" : "border-line"}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{m.track}</span>
                <span className="block text-xs text-faint">
                  {recipeSummary(r)} · {m.file_name}
                </span>
              </span>
              <button type="button" className={BTN_SM} onClick={() => load(m)}>
                Load
              </button>
              <button type="button" className={BTN_SM} disabled={pending} onClick={() => confirm(`Delete "${m.track}"?`) && run(() => deleteLabTrack(video.id, m.id))}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
