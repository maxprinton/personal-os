"use client";
// Edit tab · Passes & cuts: the 6 editing passes (✓ + date; rough cut needs a link), exports (rough / v2 /
// final + link + length) with timestamped review notes (✓ resolved), and section start times for chapters.
// Publish (Worker C) reads: final length = yt_cuts.duration_s where label contains "final"; starts = yt_sections.start_s.
import { useMemo, useState } from "react";
import { EDIT_PASSES } from "@/lib/youtube/constants";
import { chaptersForVideo, chaptersText } from "@/lib/youtube/chapters";
import type { EditPass, YtClip, YtCue, YtCut, YtEditPass, YtMusic, YtReviewNote, YtSection, YtShot } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { BlurField, BTN, BTN_SM, BOX, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import { addCut, addReviewNote, deleteCut, deleteReviewNote, setPass, setReviewNoteResolved, setSectionStarts, updateCut } from "@/app/youtube-actions/edit";
import { brollProgress, clock, cueCounts, isFinalCut, isLink, parseClock, sortNotes, startProblems } from "./logic";
import { useRun } from "./useRun";

type Props = {
  videoId: string;
  sections: ShotSection[];
  rawSections: YtSection[];
  shots: YtShot[];
  clips: YtClip[];
  passes: YtEditPass[];
  cuts: YtCut[];
  notes: YtReviewNote[];
  cues: YtCue[];
  music: YtMusic[];
  wpm: number;
};

export default function PassesPanel(p: Props) {
  return (
    <div className="space-y-4">
      <Passes {...p} />
      <Cuts videoId={p.videoId} cuts={p.cuts} notes={p.notes} />
      <Starts videoId={p.videoId} rawSections={p.rawSections} sections={p.sections} cuts={p.cuts} wpm={p.wpm} />
    </div>
  );
}

function Passes({ videoId, shots, clips, passes, cues, music }: Props) {
  const { run, pending, error } = useRun();
  const byPass = new Map(passes.map((x) => [x.pass, x]));
  const broll = brollProgress(shots, clips);
  const counts = cueCounts(cues);
  const extra = (id: EditPass): string | null => {
    if (id === "broll") return broll.total ? `${broll.done}/${broll.total} B-roll / screen / graphics shots in the timeline` : "No B-roll shots in the shot list";
    if (id === "annotation") return `${cues.length} cue${cues.length === 1 ? "" : "s"} on the script`;
    if (id === "music") return `${music.length} track${music.length === 1 ? "" : "s"} in the music list`;
    if (id === "sfx") return `${counts.sfx} 🔊 SFX cue${counts.sfx === 1 ? "" : "s"} in the script`;
    return null;
  };
  const doneCount = EDIT_PASSES.filter((x) => byPass.get(x.id)?.done_at).length;
  return (
    <section className={BOX}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Editing passes</h3>
        <span className="text-sm text-muted">
          {doneCount}/{EDIT_PASSES.length} done
        </span>
      </div>
      <ol className="space-y-2">
        {EDIT_PASSES.map((x, i) => {
          const row = byPass.get(x.id);
          const done = !!row?.done_at;
          const info = extra(x.id);
          return (
            <li key={x.id} className="rounded-md border border-line p-2">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={done} disabled={pending} onChange={(e) => run(() => setPass(videoId, x.id, { done: e.target.checked }))} />
                <span className="flex-1">
                  <span className={`text-sm font-medium ${done ? "text-muted line-through" : ""}`}>
                    {i + 1}. {x.label}
                  </span>
                  {done && <span className="ml-2 text-xs text-success">✓ {new Date(row!.done_at!).toLocaleDateString()}</span>}
                  <span className="block text-xs text-muted">{x.hint}</span>
                  {info && <span className="block text-xs text-fg">{info}</span>}
                </span>
              </label>
              <div className="mt-1 grid gap-2 pl-6 sm:grid-cols-2">
                {x.id === "rough_cut" && (
                  <BlurField value={row?.link ?? ""} placeholder="Rough cut link (required)" onSave={async (v) => (await setPass(videoId, x.id, { link: v })).error} />
                )}
                <BlurField value={row?.notes ?? ""} placeholder="Notes" onSave={async (v) => (await setPass(videoId, x.id, { notes: v })).error} />
              </div>
            </li>
          );
        })}
      </ol>
      <Msg error={error} />
    </section>
  );
}

const CUT_LABELS = ["rough", "v2", "v3", "final"];
const timeLink = (url: string | null, s: number) => {
  if (!url || !/youtu\.?be/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${Math.round(s)}`;
};

function Cuts({ videoId, cuts, notes }: { videoId: string; cuts: YtCut[]; notes: YtReviewNote[] }) {
  const { run, pending, error } = useRun();
  const nextLabel = CUT_LABELS.find((l) => !cuts.some((c) => c.label.toLowerCase() === l)) ?? `v${cuts.length + 1}`;
  const [f, setF] = useState({ label: "", url: "", len: "" });
  const label = f.label || nextLabel;
  return (
    <section className={BOX}>
      <h3 className="font-semibold">Exports & review notes</h3>
      <p className="text-xs text-muted">Each export (rough cut, v2, final) with its link. Watch it and add notes with the time (&quot;2:13 cut this pause&quot;). The <b>final</b> cut&apos;s length is used by Publish.</p>
      {[...cuts].reverse().map((c) => (
        <CutCard key={c.id} videoId={videoId} cut={c} notes={notes.filter((n) => n.cut_id === c.id)} />
      ))}
      <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[8rem_1fr_6rem_auto]">
        <input className={INPUT} list="yt-cut-labels" placeholder={nextLabel} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} aria-label="Cut name" />
        <datalist id="yt-cut-labels">
          {CUT_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <input className={INPUT} placeholder="Link (Drive or unlisted YouTube)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <input className={INPUT} placeholder="Length 12:34" value={f.len} onChange={(e) => setF({ ...f, len: e.target.value })} />
        <button
          type="button"
          className={PRIMARY}
          disabled={pending}
          onClick={async () => {
            if (f.len && parseClock(f.len) == null) return alert("Length like 12:34");
            const ok = await run(() => addCut(videoId, { label, url: f.url || null, duration_s: parseClock(f.len) }));
            if (ok) setF({ label: "", url: "", len: "" });
          }}
        >
          Add export
        </button>
      </div>
      {f.url && !isLink(f.url) && <p className="text-xs text-warning">That doesn&apos;t look like a link.</p>}
      <Msg error={error} />
    </section>
  );
}

function CutCard({ videoId, cut, notes }: { videoId: string; cut: YtCut; notes: YtReviewNote[] }) {
  const { run, pending, error } = useRun();
  const [at, setAt] = useState("");
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = notes.filter((n) => !n.resolved).length;
  const list = sortNotes(notes).filter((n) => showDone || !n.resolved);
  const add = async () => {
    const s = parseClock(at);
    if (s == null) return alert("Time like 2:13");
    const ok = await run(() => addReviewNote(videoId, cut.id, s, text));
    if (ok) {
      setText("");
      setAt("");
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${isFinalCut(cut.label) ? "bg-success-soft text-success" : "bg-subtle"}`}>{cut.label}</span>
        <div className="min-w-[12rem] flex-1">
          <BlurField value={cut.url ?? ""} placeholder="Link" onSave={async (v) => (await updateCut(videoId, cut.id, { url: v })).error} />
        </div>
        {cut.url && isLink(cut.url) && (
          <a href={cut.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
            Open
          </a>
        )}
        <label className="flex items-center gap-1 text-xs text-muted">
          Length
          <input
            className={`${INPUT} w-20`}
            defaultValue={clock(cut.duration_s)}
            placeholder="12:34"
            onBlur={(e) => {
              const s = e.target.value.trim() ? parseClock(e.target.value) : null;
              if (e.target.value.trim() && s == null) return alert("Length like 12:34");
              if (s !== cut.duration_s) run(() => updateCut(videoId, cut.id, { duration_s: s }));
            }}
          />
        </label>
        <span className="text-xs text-faint">{new Date(cut.created_at).toLocaleDateString()}</span>
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => confirm(`Delete the "${cut.label}" export and its notes?`) && run(() => deleteCut(videoId, cut.id))}>
          ✕
        </button>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted">
          Review notes: {open} open{notes.length - open ? ` · ${notes.length - open} resolved` : ""}
          {notes.length - open > 0 && (
            <button type="button" className={BTN_SM} onClick={() => setShowDone(!showDone)}>
              {showDone ? "Hide resolved" : "Show resolved"}
            </button>
          )}
        </div>
        {list.map((n) => (
          <div key={n.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={n.resolved} aria-label="Resolved" disabled={pending} onChange={(e) => run(() => setReviewNoteResolved(videoId, n.id, e.target.checked))} />
            <a href={timeLink(cut.url, n.at_seconds) ?? undefined} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent">
              {clock(n.at_seconds)}
            </a>
            <span className={`flex-1 ${n.resolved ? "text-muted line-through" : ""}`}>{n.text}</span>
            <button type="button" className="text-xs text-faint hover:text-danger" aria-label="Delete note" onClick={() => run(() => deleteReviewNote(videoId, n.id))}>
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className={`${INPUT} w-20`} placeholder="2:13" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Time" />
          <input className={INPUT} placeholder="What to change" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" className={BTN} disabled={pending || !text.trim()} onClick={add}>
            Add
          </button>
        </div>
      </div>
      <Msg error={error} />
    </div>
  );
}

function Starts({ videoId, rawSections, sections, cuts, wpm }: { videoId: string; rawSections: YtSection[]; sections: ShotSection[]; cuts: YtCut[]; wpm: number }) {
  const { run, pending, error, info } = useRun();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(rawSections.map((s) => [s.id, s.start_s == null ? "" : clock(s.start_s)])));
  const parsed = rawSections.map((s) => (vals[s.id]?.trim() ? parseClock(vals[s.id]) : null));
  const bad = rawSections.filter((s, i) => vals[s.id]?.trim() && parsed[i] == null);
  const problems = startProblems(parsed);
  const final = [...cuts].reverse().find((c) => isFinalCut(c.label) && c.duration_s) ?? null;
  const preview = useMemo(
    () =>
      chaptersForVideo(
        rawSections.map((s, i) => ({ kind: s.kind, title: s.title, start_s: parsed[i], words: s.words, content: s.content })),
        { wpm, durationS: final?.duration_s ?? null },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(parsed), rawSections, wpm, final?.duration_s],
  );
  const codeOf = (id: string) => sections.find((s) => s.id === id)?.code ?? "";
  return (
    <section className={BOX}>
      <h3 className="font-semibold">Section start times (chapters)</h3>
      <p className="text-xs text-muted">
        Where each part starts in the <b>final</b> cut (read it from the DaVinci timeline). Publish turns these into YouTube chapters. Empty = estimated from the words.
        {final ? ` Final cut length: ${clock(final.duration_s)}.` : " Add a “final” export with its length below the passes."}
      </p>
      <div className="grid gap-1.5">
        {rawSections.map((s, i) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <span className="w-12 font-mono text-xs text-muted">{codeOf(s.id)}</span>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <input className={`${INPUT} w-24`} placeholder={i === 0 ? "0:00" : "m:ss"} value={vals[s.id] ?? ""} onChange={(e) => setVals({ ...vals, [s.id]: e.target.value })} aria-label={`Start of ${s.title}`} />
          </label>
        ))}
      </div>
      {bad.length > 0 && <p className="text-xs text-danger">Use times like 1:05 ({bad.map((s) => s.title).join(", ")}).</p>}
      {problems.map((p) => (
        <p key={p} className="text-xs text-warning">
          {p}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={pending || bad.length > 0} onClick={() => run(() => setSectionStarts(videoId, rawSections.map((s, i) => ({ id: s.id, start_s: parsed[i] }))), "Start times saved.")}>
          Save start times
        </button>
        <Msg error={error} info={info} />
      </div>
      <div className="rounded-md bg-subtle p-2">
        <p className="text-xs font-medium text-muted">Chapters preview{preview.estimated ? " (some times are estimated)" : ""}</p>
        <pre className="whitespace-pre-wrap text-xs">{chaptersText(preview.chapters) || "—"}</pre>
        {preview.check.problems.map((p) => (
          <p key={p} className="text-xs text-warning">
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}
