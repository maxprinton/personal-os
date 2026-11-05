// /youtube/shots — Missing shots backlog: every unfilmed shot of every active video (Worker B).
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import type { YtSection, YtShot, YtVideo } from "@/lib/youtube/types";
import Backlog, { type BacklogShot } from "@/components/youtube/shots/Backlog";
import { sortShots } from "@/components/youtube/shots/logic";

export const dynamic = "force-dynamic";

export default async function ShotsBacklogPage() {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const { data: shotRows, error } = await supabase.from("yt_shots").select("*").eq("done", false).order("position").limit(3000);
  if (error) {
    if (isMissingTable(error)) return null; // the layout shows the "run the migration" panel
    return <p className="text-sm text-danger">Couldn't load the shots: {error.message}</p>;
  }
  const shots = (shotRows ?? []) as YtShot[];
  const videoIds = [...new Set(shots.map((s) => s.video_id))];
  const sectionIds = [...new Set(shots.map((s) => s.section_id).filter((x): x is string => !!x))];
  const [{ data: vids }, { data: secs }] = await Promise.all([
    videoIds.length ? supabase.from("yt_videos").select("id,code,idea_name,stage").in("id", videoIds) : Promise.resolve({ data: [] as unknown[] }),
    sectionIds.length ? supabase.from("yt_sections").select("id,num,title,kind,position").in("id", sectionIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const videoById = new Map(((vids ?? []) as Pick<YtVideo, "id" | "code" | "idea_name" | "stage">[]).map((v) => [v.id, v]));
  const secById = new Map(((secs ?? []) as Pick<YtSection, "id" | "num" | "title" | "kind" | "position">[]).map((s) => [s.id, s]));
  const rows: BacklogShot[] = [];
  for (const s of shots) {
    const v = videoById.get(s.video_id);
    if (!v || v.stage === "archived") continue;
    const sec = s.section_id ? secById.get(s.section_id) : undefined;
    rows.push({ ...s, videoCode: v.code, videoName: v.idea_name, sectionNum: sec?.num ?? null, sectionTitle: sec?.title ?? null });
  }
  // video by code, then by section number, then script order inside the section
  const order = [...secById.values()].sort((a, b) => (a.num ?? (a.kind === "intro" ? -1 : a.kind === "closing" ? 999 : a.position)) - (b.num ?? (b.kind === "intro" ? -1 : b.kind === "closing" ? 999 : b.position)));
  const sorted = sortShots(rows, order.map((s) => ({ id: s.id, paragraphs: [] }))).sort((a, b) => String(a.videoCode ?? "~").localeCompare(String(b.videoCode ?? "~")));
  return <Backlog shots={sorted} />;
}
