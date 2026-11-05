// /youtube/v/[id]/edit — clips, ingest, annotated script, editing passes, exports + review notes, chapters, music list (Worker B).
import { notFound } from "next/navigation";
import { loadEditData } from "@/components/youtube/edit/load";
import EditWorkspace from "@/components/youtube/edit/EditWorkspace";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, missing } = await loadEditData(id);
  if (missing) return null;
  if (!data) notFound();
  const v = data.video;
  return (
    <EditWorkspace
      video={{ id: v.id, code: v.code, idea_name: v.idea_name, footage_folder: v.footage_folder, kind: v.kind }}
      sections={data.sections}
      rawSections={data.rawSections}
      shots={data.shots}
      clips={data.clips}
      passes={data.passes}
      cuts={data.cuts}
      notes={data.notes}
      cues={data.cues}
      music={data.music}
      wpm={data.wpm}
    />
  );
}
