// Shapes the Research Laboratory screens share (Worker A). Pure: used by the pages (server) and the
// client components.
import type { YtBucket, YtCard } from "@/lib/youtube/types";

/** One note as the lab's drawer needs it (from the notes database, cut down). */
export type LabNote = {
  id: string;
  title: string;
  icon: string | null;
  typeId: string | null;
  areaId: string | null;
  tags: string[];
  summary: string | null;
  text: string;
  updatedAt: string;
};
export type LabOption = { id: string; name: string; color: string };
export type LabVideo = { id: string; code: string | null; idea_name: string; stage: string };
export type LabReference = { id: string; title: string; url: string; thumbnail_url: string | null; channel_title: string | null; views: number | null; outlier_score: number | null };
export type LabBucket = Pick<YtBucket, "id" | "video_id" | "name" | "description" | "position">;
export type LabCard = YtCard;
export type LabLink = { id: string; from_id: string; to_id: string; kind: string; note: string | null };

/** Drag & drop payload (desktop only; phones use the buttons). */
export const DND = "application/x-yt-research";
export type DragPayload = { t: "note"; id: string } | { t: "card"; id: string } | { t: "copy"; id: string };
export const readDrag = (dt: DataTransfer): DragPayload | null => {
  try {
    const raw = dt.getData(DND);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
};
export const hasDrag = (dt: DataTransfer) => Array.from(dt.types ?? []).includes(DND);

export const labVideoLabel = (v: Pick<LabVideo, "code" | "idea_name">) => (v.code ? `${v.code} · ${v.idea_name}` : v.idea_name);
