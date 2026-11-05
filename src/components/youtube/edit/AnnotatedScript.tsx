"use client";
// Edit tab · Annotated script: made from the script + shot list. Under each line its shots, plus edit
// cues 🎵 music · 🔊 SFX · ✂️ cut · 🔍 zoom (notes on the script, never part of the exported script). Print / copy (Worker B).
import { useMemo, useState } from "react";
import { CUE_KINDS, MUSIC_MOODS } from "@/lib/youtube/constants";
import type { CueKind, YtClip, YtCue, YtShot } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { BTN, BTN_SM, BOX, Chip, INPUT, Msg } from "@/components/youtube/script/ui";
import { addCue, deleteCue } from "@/app/youtube-actions/edit";
import { annotate, annotatedHtml, annotatedText, clock, cueCounts, cueLabel, parseClock, shotLabel, shotStatus } from "./logic";
import { StatusPill } from "./ClipsPanel";
import { copyText, useRun } from "./useRun";

export default function AnnotatedScript({ video, sections, shots, cues, clips }: { video: { id: string; code: string | null; idea_name: string }; sections: ShotSection[]; shots: YtShot[]; cues: YtCue[]; clips: YtClip[] }) {
  const blocks = useMemo(() => annotate(sections, shots, cues), [sections, shots, cues]);
  const counts = cueCounts(cues);
  const title = `${video.code ?? ""} ${video.idea_name} — annotated script`.trim();
  const [adding, setAdding] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { run, pending, error } = useRun();

  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return alert("Allow pop-ups to print.");
    w.document.write(annotatedHtml(blocks, title));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="space-y-4">
      <div className={`${BOX} flex flex-wrap items-center gap-2`}>
        <span className="text-sm">
          {CUE_KINDS.map((k) => `${k.icon} ${counts[k.id]}`).join(" · ")}
        </span>
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={print}>
          Print / PDF
        </button>
        <button type="button" className={BTN} onClick={async () => setCopied(await copyText(annotatedText(blocks, title)))}>
          {copied ? "Copied" : "Copy as text"}
        </button>
        <p className="w-full text-xs text-muted">Cues are notes on the script for editing. They never go into the script exported to Notes. Add a time (after the rough cut) to place music changes exactly.</p>
      </div>
      <Msg error={error} />
      {!sections.some((s) => s.paragraphs.length) && <p className="text-sm text-muted">The script is empty. Write it in the Script tab first.</p>}
      {blocks.map((b) => (
        <section key={b.section.id} className="space-y-2">
          <h3 className="border-b border-line pb-1 text-sm font-semibold">
            {b.section.code} · {b.section.title}
          </h3>
          {b.paras.map((p) => {
            const id = `${b.section.id}:${p.key}`;
            return (
              <div key={id} className="group rounded-md px-2 py-1.5 hover:bg-subtle/50">
                <p className="text-sm leading-relaxed">{p.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-3">
                  {p.shots.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 font-mono text-[11px] text-accent">
                      {shotLabel(s)} <StatusPill status={shotStatus(s.id, clips)} />
                    </span>
                  ))}
                  {p.cues.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 font-mono text-[11px] text-warning">
                      {cueLabel(c)}
                      <button type="button" aria-label="Remove cue" className="text-faint hover:text-danger" disabled={pending} onClick={() => run(() => deleteCue(video.id, c.id))}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <button type="button" className={`${BTN_SM} opacity-60 group-hover:opacity-100`} onClick={() => setAdding(adding === id ? null : id)}>
                    + cue
                  </button>
                </div>
                {adding === id && (
                  <CueForm
                    onCancel={() => setAdding(null)}
                    onAdd={async (c) => {
                      const ok = await run(() => addCue(video.id, { section_id: b.section.id, block_id: p.key, anchor_text: p.text.slice(0, 120), ...c }));
                      if (ok) setAdding(null);
                    }}
                    pending={pending}
                  />
                )}
              </div>
            );
          })}
          {(b.looseShots.length > 0 || b.looseCues.length > 0) && (
            <div className="rounded-md border border-dashed border-line p-2 text-xs text-muted">
              Lines changed in the script:{" "}
              {b.looseShots.map((s) => (
                <span key={s.id} className="mr-2 font-mono">{shotLabel(s)}</span>
              ))}
              {b.looseCues.map((c) => (
                <span key={c.id} className="mr-2 font-mono">
                  {cueLabel(c)}{" "}
                  <button type="button" className="hover:text-danger" onClick={() => run(() => deleteCue(video.id, c.id))} aria-label="Remove cue">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="text-xs text-faint">DaVinci marker file: not included yet (the import format still has to be checked in Resolve). Use the printed script on a second screen.</p>
    </div>
  );
}

type CueIn = { kind: CueKind; text: string | null; mood: string | null; energy: number | null; at_s: number | null };
function CueForm({ onAdd, onCancel, pending }: { onAdd: (c: CueIn) => void; onCancel: () => void; pending: boolean }) {
  const [kind, setKind] = useState<CueKind>("music");
  const [text, setText] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState<number | null>(null);
  const [at, setAt] = useState("");
  const placeholder = kind === "music" ? "starts / changes / stops…" : kind === "sfx" ? "whoosh, pop, ding…" : kind === "cut" ? "pause, jump cut…" : "punch in on…";
  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-surface p-2">
      <div className="flex flex-wrap gap-1.5">
        {CUE_KINDS.map((k) => (
          <Chip key={k.id} on={kind === k.id} onClick={() => setKind(k.id)}>
            {k.icon} {k.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} min-w-[10rem] flex-1`} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        {kind === "music" && (
          <>
            <select className={`${INPUT} w-auto`} value={mood} onChange={(e) => setMood(e.target.value)} aria-label="Mood">
              <option value="">mood…</option>
              {MUSIC_MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select className={`${INPUT} w-auto`} value={energy ?? ""} onChange={(e) => setEnergy(e.target.value ? Number(e.target.value) : null)} aria-label="Energy">
              <option value="">energy…</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  energy {n}
                </option>
              ))}
            </select>
          </>
        )}
        <input className={`${INPUT} w-24`} placeholder="time 2:13" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Time in the cut (optional)" />
        <button type="button" className={BTN} disabled={pending} onClick={() => onAdd({ kind, text: text || null, mood: kind === "music" ? mood || null : null, energy: kind === "music" ? energy : null, at_s: parseClock(at) })}>
          Add
        </button>
        <button type="button" className={BTN_SM} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {at && parseClock(at) == null && <p className="text-xs text-danger">Time like 2:13</p>}
      {at && parseClock(at) != null && <p className="text-xs text-faint">at {clock(parseClock(at))}</p>}
    </div>
  );
}
