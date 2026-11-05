"use client";
// Edit tab · Music: every track used in the video (name, source/license, section). Music Lab tracks come in
// by themselves from the Music tab (Worker B). Publish (C) uses this list for the credits.
import { useState } from "react";
import Link from "next/link";
import { videoHref } from "@/lib/youtube/constants";
import type { MusicSource, YtMusic } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { BlurField, BTN, BTN_SM, BOX, INPUT, Msg } from "@/components/youtube/script/ui";
import { addMusicTrack, deleteMusicTrack, updateMusicTrack } from "@/app/youtube-actions/edit";
import { clock } from "./logic";
import { useRun } from "./useRun";

const SOURCES: { id: MusicSource; label: string }[] = [
  { id: "library", label: "Library (YouTube Audio Library, Epidemic…)" },
  { id: "music_lab", label: "Music Lab" },
  { id: "other", label: "Other" },
];

export default function MusicList({ videoId, sections, music, sfx }: { videoId: string; sections: ShotSection[]; music: YtMusic[]; sfx: number }) {
  const { run, pending, error } = useRun();
  const [f, setF] = useState({ track: "", source: "library" as MusicSource, license: "", section_id: "", file_name: "" });
  return (
    <section className={BOX}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Music & SFX</h3>
        <Link href={videoHref(videoId, "music")} className={BTN}>
          🎛 Open Music Lab
        </Link>
      </div>
      <p className="text-xs text-muted">🔊 {sfx} SFX cue{sfx === 1 ? "" : "s"} marked in the annotated script.</p>
      {!music.length && <p className="text-sm text-muted">No tracks yet.</p>}
      {music.map((m) => (
        <div key={m.id} className="grid items-center gap-2 rounded-md border border-line p-2 text-sm sm:grid-cols-[1fr_12rem_10rem_auto]">
          <div className="min-w-0">
            <BlurField value={m.track} ariaLabel="Track" onSave={async (v) => (await updateMusicTrack(videoId, m.id, { track: v })).error} />
            <p className="mt-0.5 truncate text-xs text-faint">
              {SOURCES.find((s) => s.id === m.source)?.label.split(" (")[0]}
              {m.file_name ? ` · ${m.file_name}` : ""}
              {m.start_s != null ? ` · ${clock(m.start_s)}–${clock(m.end_s)}` : ""}
            </p>
          </div>
          <BlurField value={m.license ?? ""} placeholder="License" onSave={async (v) => (await updateMusicTrack(videoId, m.id, { license: v })).error} />
          <select className={INPUT} value={m.section_id ?? ""} disabled={pending} onChange={(e) => run(() => updateMusicTrack(videoId, m.id, { section_id: e.target.value || null }))} aria-label="Section">
            <option value="">Whole video</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.title}
              </option>
            ))}
          </select>
          <button type="button" className={BTN_SM} disabled={pending} onClick={() => confirm(`Remove "${m.track}"?`) && run(() => deleteMusicTrack(videoId, m.id))}>
            ✕
          </button>
        </div>
      ))}
      <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
        <input className={INPUT} placeholder="Track name / artist" value={f.track} onChange={(e) => setF({ ...f, track: e.target.value })} />
        <select className={INPUT} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as MusicSource })} aria-label="Source">
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <input className={INPUT} placeholder="License / attribution" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} />
        <select className={INPUT} value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })} aria-label="Section">
          <option value="">Whole video</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.title}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className={BTN}
        disabled={pending || !f.track.trim()}
        onClick={async () => {
          const ok = await run(() => addMusicTrack(videoId, { ...f, section_id: f.section_id || null, file_name: f.file_name || null }));
          if (ok) setF({ ...f, track: "", license: "" });
        }}
      >
        Add track
      </button>
      <Msg error={error} />
    </section>
  );
}
