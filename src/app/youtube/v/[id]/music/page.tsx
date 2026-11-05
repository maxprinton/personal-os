// /youtube/v/[id]/music — Music Lab: algorithmic background music (no AI) from the channel's sonic identity
// and the video's energy curve (Worker B).
import { notFound } from "next/navigation";
import { loadEditData } from "@/components/youtube/edit/load";
import MusicLab from "@/components/youtube/music/MusicLab";

export const dynamic = "force-dynamic";

export default async function MusicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, missing } = await loadEditData(id);
  if (missing) return null;
  if (!data) notFound();
  const v = data.video;
  const final = [...data.cuts].reverse().find((c) => /final/i.test(c.label) && c.duration_s) ?? null;
  return (
    <MusicLab
      video={{ id: v.id, code: v.code, idea_name: v.idea_name }}
      sections={data.rawSections.map((s) => {
        const code = data.sections.find((x) => x.id === s.id)?.code ?? "";
        return { id: s.id, kind: s.kind, title: s.title, words: s.words ?? 0, energy: s.energy, start_s: s.start_s, is_climax: s.is_climax, code };
      })}
      cues={data.cues.filter((c) => c.kind === "music").map((c) => ({ section_id: c.section_id, energy: c.energy, at_s: c.at_s, mood: c.mood }))}
      finalLength={final?.duration_s ?? null}
      wpm={data.wpm}
      sonic={data.sonic}
      saved={data.music.filter((m) => m.source === "music_lab")}
    />
  );
}
