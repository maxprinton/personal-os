// /youtube/v/[id]/film — Filming mode (full screen, phone-friendly) (Worker B).
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { loadPinnedPair, loadShotData } from "@/components/youtube/shots/load";
import FilmMode from "@/components/youtube/shots/FilmMode";

export const dynamic = "force-dynamic";

export default async function FilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, missing } = await loadShotData(id);
  if (missing) return null;
  if (!data) notFound();
  const v = data.video;
  const pinned = await loadPinnedPair(v.id);
  return (
    <FilmMode
      video={{ id: v.id, code: v.code, idea_name: v.idea_name, kind: v.kind }}
      sections={data.sections}
      rawSections={data.rawSections}
      shots={data.shots}
      moments={data.moments}
      pinned={pinned}
      wpm={data.wpm}
      aiReady={hasAi()}
      drift={data.drift}
    />
  );
}
