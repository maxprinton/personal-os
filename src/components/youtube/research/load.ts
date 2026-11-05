// Server loader of the Research Laboratory pages (Worker A): notes (cut down for the drawer), Type / Area
// options, buckets + shelves, cards, references, videos and "Used in". Server only.
import { getNotesDatabase } from "@/lib/notes-db/server";
import { propByKey } from "@/lib/notes-db/builtins";
import { ytServer } from "@/lib/youtube/db";
import { usedIn as usedInMap } from "@/lib/youtube/research";
import type { LabBucket, LabCard, LabLink, LabNote, LabOption, LabReference, LabVideo } from "./shared";

export type LabData = {
  notes: LabNote[];
  typeOptions: LabOption[];
  areaOptions: LabOption[];
  buckets: LabBucket[];
  cards: LabCard[];
  videos: LabVideo[];
  references: LabReference[];
  links: LabLink[];
  usedIn: Record<string, LabVideo[]>;
};

export async function loadLab(opts: { videoId?: string | null } = {}): Promise<LabData> {
  const { supabase: sb } = await ytServer();
  const notesP = (async () => {
    try {
      const db = await getNotesDatabase(sb);
      const type = propByKey(db.properties, "type");
      const area = propByKey(db.properties, "area");
      const summary = propByKey(db.properties, "ai_summary");
      const opt = (p: typeof type) => (p?.config.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color as string }));
      const notes: LabNote[] = db.notes.map((n) => {
        const s = summary ? (n.values[summary.id] as { text?: string } | null | undefined) : null;
        const t = type ? n.values[type.id] : null;
        const a = area ? n.values[area.id] : null;
        return {
          id: n.id,
          title: n.title || "Untitled",
          icon: n.icon,
          typeId: typeof t === "string" ? t : null,
          areaId: typeof a === "string" ? a : null,
          tags: n.tags.map((x) => x.name),
          summary: s && typeof s === "object" && typeof s.text === "string" ? s.text.slice(0, 400) : null,
          text: n.text.slice(0, 1500),
          updatedAt: n.updatedAt,
        };
      });
      return { notes, typeOptions: opt(type), areaOptions: opt(area) };
    } catch (e) {
      // Notes database migration missing: plain notes (no Type / Area filters)
      console.error("lab notes", e);
      const { data } = await sb.from("notes").select("id,title,content,updated_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(2000);
      const notes: LabNote[] = ((data ?? []) as { id: string; title: string | null; content: string | null; updated_at: string }[]).map((n) => ({
        id: n.id,
        title: n.title || "Untitled",
        icon: null,
        typeId: null,
        areaId: null,
        tags: [],
        summary: null,
        text: String(n.content ?? "").replace(/\s+/g, " ").slice(0, 1500),
        updatedAt: n.updated_at,
      }));
      return { notes, typeOptions: [] as LabOption[], areaOptions: [] as LabOption[] };
    }
  })();

  const vid = opts.videoId ?? null;
  const bucketsQ = sb.from("yt_buckets").select("id,video_id,name,description,position").order("position");
  const linksQ = vid
    ? sb.from("yt_video_links").select("id,from_id,to_id,kind,note").or(`from_id.eq.${vid},to_id.eq.${vid}`).order("position")
    : sb.from("yt_video_links").select("id,from_id,to_id,kind,note").order("position").limit(500);
  const [n, bucketsR, cardsR, videosR, linksR] = await Promise.all([
    notesP,
    vid ? bucketsQ.or(`video_id.eq.${vid},video_id.is.null`) : bucketsQ,
    sb.from("yt_cards").select("*").order("position").limit(5000),
    sb.from("yt_videos").select("id,code,idea_name,stage").neq("stage", "archived").order("created_at", { ascending: false }).limit(1000),
    linksQ,
  ]);
  const cards = (cardsR.data ?? []) as LabCard[];
  const videos = (videosR.data ?? []) as LabVideo[];
  const refIds = [...new Set(cards.map((c) => c.reference_id).filter((x): x is string => !!x))];
  let references: LabReference[] = [];
  if (refIds.length) {
    const { data } = await sb
      .from("yt_references")
      .select("id,title,url,thumbnail_url,channel_title,views,outlier_score")
      .in("id", refIds.slice(0, 500));
    references = (data ?? []) as LabReference[];
  }
  const used = usedInMap(cards, videos);
  return {
    ...n,
    buckets: (bucketsR.data ?? []) as LabBucket[],
    cards,
    videos,
    references,
    links: (linksR.data ?? []) as LabLink[],
    usedIn: Object.fromEntries(used),
  };
}
