"use client";
// /youtube/v/[id]/edit — the Edit tab (Worker B): Clips · Ingest · Annotated script · Passes & cuts · Music.
import { useEffect, useState } from "react";
import Link from "next/link";
import { videoHref } from "@/lib/youtube/constants";
import type { YtClip, YtCue, YtCut, YtEditPass, YtMusic, YtReviewNote, YtSection, YtShot } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { Chip } from "@/components/youtube/script/ui";
import ClipsPanel from "./ClipsPanel";
import IngestPanel from "./IngestPanel";
import AnnotatedScript from "./AnnotatedScript";
import PassesPanel from "./PassesPanel";
import MusicList from "./MusicList";
import { collectProgress, phoneOnly, sfxCount } from "./logic";

type Tab = "clips" | "ingest" | "script" | "passes" | "music";
const TABS: { id: Tab; label: string }[] = [
  { id: "clips", label: "Clips" },
  { id: "ingest", label: "Ingest" },
  { id: "script", label: "Annotated script" },
  { id: "passes", label: "Passes & cuts" },
  { id: "music", label: "Music" },
];

export type EditProps = {
  video: { id: string; code: string | null; idea_name: string; footage_folder: string | null; kind: string };
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

export default function EditWorkspace(p: EditProps) {
  const [tab, setTab] = useState<Tab>("clips");
  useEffect(() => {
    try {
      const t = sessionStorage.getItem("yt-edit-tab") as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTab(t);
    } catch {}
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    try {
      sessionStorage.setItem("yt-edit-tab", t);
    } catch {}
  };
  const intro = p.rawSections.find((s) => s.kind === "intro");
  const introOk = !intro || intro.intro_status === "filmed";
  const pickups = p.shots.filter((s) => s.is_pickup && !s.done);
  const phone = phoneOnly(p.clips).length;
  const prog = collectProgress(p.shots, p.clips);
  const openNotes = p.notes.filter((n) => !n.resolved).length;

  return (
    <div className="space-y-4">
      {(!introOk || pickups.length > 0) && (
        <div className="space-y-1 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
          {!introOk && (
            <p>
              ⚠️ The intro is <b>{intro?.intro_status?.replace("_", " ") ?? "not written"}</b>, not Final + Filmed yet — pickups pending.{" "}
              <Link className="text-accent underline" href={`${videoHref(p.video.id, "script")}`}>
                Open the intro
              </Link>
            </p>
          )}
          {pickups.length > 0 && (
            <p>
              🎬 {pickups.length} pickup shot{pickups.length > 1 ? "s" : ""} still to film.{" "}
              <Link className="text-accent underline" href={videoHref(p.video.id, "film")}>
                Filming mode
              </Link>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Chip key={t.id} on={tab === t.id} onClick={() => pick(t.id)}>
            {t.label}
            {t.id === "clips" && ` ${prog.done}/${prog.total}`}
            {t.id === "clips" && phone > 0 && " 📱"}
            {t.id === "passes" && openNotes > 0 && ` · ${openNotes} notes`}
          </Chip>
        ))}
      </div>
      {tab === "clips" && <ClipsPanel video={p.video} sections={p.sections} shots={p.shots} clips={p.clips} />}
      {tab === "ingest" && <IngestPanel video={p.video} sections={p.sections} shots={p.shots} clips={p.clips} />}
      {tab === "script" && <AnnotatedScript video={p.video} sections={p.sections} shots={p.shots} cues={p.cues} clips={p.clips} />}
      {tab === "passes" && (
        <PassesPanel videoId={p.video.id} sections={p.sections} rawSections={p.rawSections} shots={p.shots} clips={p.clips} passes={p.passes} cuts={p.cuts} notes={p.notes} cues={p.cues} music={p.music} wpm={p.wpm} />
      )}
      {tab === "music" && <MusicList videoId={p.video.id} sections={p.sections} music={p.music} sfx={sfxCount(p.cues)} />}
    </div>
  );
}
