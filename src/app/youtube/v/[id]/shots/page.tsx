// /youtube/v/[id]/shots — shot list made from the script (Worker B).
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { loadShotData } from "@/components/youtube/shots/load";
import ShotList from "@/components/youtube/shots/ShotList";

export const dynamic = "force-dynamic";

export default async function ShotsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, missing } = await loadShotData(id);
  if (missing) return null;
  if (!data) notFound();
  const v = data.video;
  return (
    <ShotList
      video={{ id: v.id, code: v.code, idea_name: v.idea_name, kind: v.kind, locked: !!v.outline_locked_at }}
      sections={data.sections}
      shots={data.shots}
      drift={data.drift}
      aiReady={hasAi()}
    />
  );
}
